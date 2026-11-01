import OpenAI from "openai";
import { z } from "zod";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// OpenRouter client (OpenAI-compatible) – lazy singleton
//
// The client is created on first use rather than at module load so that
// Next.js can statically analyse routes during `next build` without requiring
// OPENROUTER_API_KEY to be present at build time.
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
  }
  return _client;
}

/** Convenience re-export for callers that used the old named export. */
export const openrouter = {
  get chat() {
    return getOpenRouterClient().chat;
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ```json ... ``` fences that some models wrap around their output. */
function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const schemaIds = new WeakMap<object, number>();
let nextSchemaId = 0;

function getSchemaId(schema: object): number {
  let id = schemaIds.get(schema);
  if (id === undefined) {
    id = ++nextSchemaId;
    schemaIds.set(schema, id);
  }
  return id;
}

function isRateLimitError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 429;
}

function isInsufficientCreditsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 402;
}

function validationRetryGuidance(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  const issues = error.issues
    .map((issue) => issue.path.length ? issue.path.join(".") : "response")
    .slice(0, 20);
  return `The previous model response did not match the required JSON schema. Correct these fields: ${issues.join(", ")}. ` +
    "Return the complete corrected JSON object. Preserve exact field names and JSON types; do not omit required fields.";
}

function retryDelay(error: unknown): number {
  const headers = typeof error === "object" && error !== null && "headers" in error
    ? error.headers
    : undefined;
  const retryAfter = headers instanceof Headers
    ? headers.get("retry-after")
    : typeof headers === "object" && headers !== null && "retry-after" in headers &&
      typeof headers["retry-after"] === "string"
      ? headers["retry-after"]
      : undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, 1500)
    : 400;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// ---------------------------------------------------------------------------
// llmJson
// ---------------------------------------------------------------------------

/**
 * Call the configured OpenRouter model, parse the response as JSON, and
 * validate it against a Zod schema.  Retries once on parse/validation failure.
 *
 * @param system   System prompt.
 * @param messages Conversation history (role + content pairs).
 * @param schema   Zod schema to validate the parsed object against.
 * @returns        The validated, typed object.
 */
export async function llmJson<T>(
  system: string,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  options: { maxTokens?: number } = {},
): Promise<T> {
  const model = process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct";
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL ?? "openai/gpt-4o-mini";
  const client = getOpenRouterClient();
  const key = createHash("sha256").update(JSON.stringify({
    system,
    messages,
    model,
    fallbackModel,
    maxTokens: options.maxTokens,
    schemaId: getSchemaId(schema),
  })).digest("hex");
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return schema.parse(cached.value);
  if (cached) responseCache.delete(key);
  const pending = inFlightRequests.get(key);
  if (pending) return schema.parse(await pending);

  const systemMessage: ChatMessage = {
    role: "system",
    content: `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences, no explanation.`,
  };

  async function attempt(m: string, correction?: string): Promise<T> {
    const response = await client.chat.completions.create({
      model: m,
      messages: [
        systemMessage,
        ...(correction ? [{ role: "system" as const, content: correction }] : []),
        ...messages,
      ],
      response_format: { type: "json_object" },
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const cleaned = stripCodeFences(raw);
    const parsed: unknown = JSON.parse(cleaned);
    return schema.parse(parsed);
  }

  const request = async () => {
    try {
      return await attempt(model);
    } catch (firstError) {
      if (isInsufficientCreditsError(firstError)) {
        console.warn("[llmJson] Provider credits cannot cover this request; skipping the fallback attempt.");
        throw firstError;
      }
      console.warn(`[llmJson] First attempt failed with ${model}, retrying with fallback ${fallbackModel}.`);
      if (isRateLimitError(firstError)) await wait(retryDelay(firstError));
      try {
        return await attempt(fallbackModel, validationRetryGuidance(firstError));
      } catch (secondError) {
        console.error("[llmJson] Both model attempts failed.");
        throw secondError;
      }
    }
  };
  const pendingRequest = request();
  inFlightRequests.set(key, pendingRequest);
  try {
    const result = await pendingRequest;
    responseCache.set(key, { value: result, expiresAt: Date.now() + 15_000 });
    if (responseCache.size > 200) {
      const now = Date.now();
      for (const [cacheKey, entry] of responseCache) {
        if (entry.expiresAt <= now || responseCache.size > 200) responseCache.delete(cacheKey);
        if (responseCache.size <= 150) break;
      }
    }
    return result;
  } finally {
    inFlightRequests.delete(key);
  }
}

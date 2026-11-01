import { z } from "zod";

export type JsonBodyResult<T> =
  | { success: true; data: T }
  | { success: false; status: 400 | 413; error: string };

export function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 32 * 1024,
): Promise<JsonBodyResult<T>> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { success: false, status: 413, error: "The request body is too large." };
  }

  const reader = request.body?.getReader();
  if (!reader) return { success: false, status: 400, error: "The request body is invalid." };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { success: false, status: 413, error: "The request body is too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { success: false, status: 400, error: "The request body is invalid." };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { success: false, status: 400, error: "The request body is not valid JSON." };
  }

  const parsed = schema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, status: 400, error: "The request body is invalid or too long." };
}

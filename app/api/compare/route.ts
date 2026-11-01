import { NextResponse } from "next/server";
import { llmJson } from "@/lib/llm";
import { z } from "zod";
import { consumeRateLimit, publicRateLimitIdentity } from "@/lib/run/security";
import { parseJsonBody } from "@/lib/apiRequest";

const RequestSchema = z.object({
  quotes: z.string().trim().min(1).max(6000),
  budgetLine: z.string().trim().min(1).max(500),
}).strict();
const CompareSchema = z.object({
  comparison: z.array(z.object({
    vendor: z.string().max(120),
    included: z.array(z.string().max(240)).max(20),
    guestsCovered: z.string().max(240),
    extraCharges: z.string().max(500),
    questions: z.array(z.string().max(240)).max(20),
    budgetFit: z.string().max(500),
    totalCost: z.number().finite().min(0).max(1_000_000_000),
  })).max(12),
  recommendation: z.string().max(1200),
});

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, RequestSchema, 16 * 1024);
    if (!body.success) return NextResponse.json({ error: body.error }, { status: body.status });
    const requestBody = body.data;
    if (!await consumeRateLimit(`llm:compare:${publicRateLimitIdentity(req)}`, 8)) {
      return NextResponse.json({ error: "Too many quote comparisons. Please wait a minute and retry." }, { status: 429 });
    }
    const { quotes, budgetLine } = requestBody;

    const system = `Compare these vendor quotes. Be objective.
    Current budget allocation for this category: ${budgetLine}.
    State clearly that this only compares what was provided.`;

    const res = await llmJson(
      system,
      [{ role: "user", content: `Quotes: ${quotes}` }],
      CompareSchema
    );

    return NextResponse.json(res);
  } catch (err) {
      console.error("Compare API error:", err);
      if (err instanceof z.ZodError || err instanceof SyntaxError) {
        return NextResponse.json({ error: "The quote comparison request is invalid or too long." }, { status: 400 });
      }
      return NextResponse.json({ error: "Unable to compare these quotes right now. Please retry." }, { status: 503 });
    }
}

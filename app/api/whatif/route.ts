import { NextResponse } from "next/server";
import { llmJson } from "@/lib/llm";
import { z } from "zod";
import { consumeRateLimit, publicRateLimitIdentity } from "@/lib/run/security";
import { parseJsonBody } from "@/lib/apiRequest";

const RequestSchema = z.object({
  eventId: z.string().uuid().optional(),
  scenario: z.string().trim().min(1).max(1200),
  currentPlan: z.object({
    eventType: z.string().min(1).max(80),
    eventDate: z.string().max(40),
    guestCount: z.number().int().min(0).max(100_000),
    city: z.string().max(120),
    budgetTotal: z.number().int().min(1).max(1_000_000_000),
    budgetBreakdown: z.array(z.object({
      category: z.string().max(120),
      allocated: z.number().finite().min(0).max(1_000_000_000),
    })).max(30),
    timeline: z.array(z.object({
      task: z.string().max(160),
      time: z.string().max(40),
      owner: z.string().max(120),
      status: z.enum(["pending", "in_progress", "done", "cancelled"]),
      description: z.string().max(500).optional(),
    })).max(40),
  }),
}).strict();

const WhatIfSchema = z.object({
  costImpact: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  affectedCategories: z.array(z.object({
    category: z.string().max(120),
    change: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
    reason: z.string().max(500),
  })).max(30),
  summary: z.string().max(1200),
});

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, RequestSchema, 96 * 1024);
    if (!body.success) return NextResponse.json({ error: body.error }, { status: body.status });
    const { scenario, currentPlan } = body.data;
    if (!await consumeRateLimit(`llm:whatif:${publicRateLimitIdentity(req)}`, 8)) {
      return NextResponse.json({ error: "Too many scenario analyses. Please wait a minute and retry." }, { status: 429 });
    }

    const system = `You are a financial event strategist. Analyze a "What If" scenario.
    Estimate cost impact and which categories must give if the budget stays the same.
    Or if the budget increases, how it's distributed.
    Scenario: ${scenario}`;

    const res = await llmJson(
      system,
      [{ role: "user", content: `Current Plan: ${JSON.stringify(currentPlan)}` }],
      WhatIfSchema
    );

    return NextResponse.json(res);
  } catch (err) {
      console.error("WhatIf API error:", err);
      if (err instanceof z.ZodError || err instanceof SyntaxError) {
        return NextResponse.json({ error: "The scenario request is invalid or too long." }, { status: 400 });
      }
      return NextResponse.json({ error: "Unable to analyze this scenario right now. Please retry." }, { status: 503 });
    }
}

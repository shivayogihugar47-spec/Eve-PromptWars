import { NextResponse } from "next/server";
import { llmJson } from "@/lib/llm";
import { z } from "zod";
import { normalizeBudgetAmounts, parseBudget } from "@/lib/budget";
import { buildNextEventQuestion, type EventChatMessage } from "@/lib/eventQuestions";
import { normalizePlanForRun } from "@/lib/run/plan";
import { generateRisks } from "@/lib/run/risks";
import { consumeRateLimit, publicRateLimitIdentity, saveLockedRun } from "@/lib/run/security";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { authConfig } from "@/lib/auth";
import { parseJsonBody } from "@/lib/apiRequest";

export const dynamic = "force-dynamic";

// ─── Types exported for page.tsx ─────────────────────────────────────────────
export interface QuickOption { label: string; value: string; }
export interface AssistantCard {
  title: string;
  subtitle?: string;
  hint?: string;
  options?: QuickOption[];
  inputType?: "text" | "date" | "number";
  inputPlaceholder?: string;
  step: number;
}
export interface EventPlan {
  eventType: string; eventDate: string; guestCount: number;
  city: string; budgetTotal: number; theme?: string;
  venueStyle?: string; cateringType?: string; specialRequirements?: string;
  accessibilityNeeds: string; ageMix: string;
  eventDetails?: Record<string, string>;
  highlights?: string[];
  timeline: TimelineItem[]; budgetBreakdown: BudgetItem[];
  vendors: VendorItem[]; checklist: ChecklistItem[];
}
export interface TimelineItem {
  time: string; task: string; owner: string; description?: string;
  status: "pending" | "in_progress" | "done" | "cancelled"; icon: string;
  id?: string; startAt?: string; durationMin?: number; dependsOn?: string[]; vendorName?: string; actualAt?: string;
}
export interface BudgetItem {
  category: string; allocated: number; percentage: number; icon: string; notes?: string;
}
export interface VendorItem {
  name: string; category: string; description?: string;
  status: "pending" | "contacted" | "booked";
  priority: "high" | "medium" | "low"; icon: string; estimatedCost?: string;
}
export interface ChecklistItem {
  task: string; dueDate: string; done: boolean; icon: string; category?: string;
}

const GeneratedPlanSchema = z.object({
  eventType: z.string().min(1).max(80),
  eventDate: z.string().min(1).max(40),
  guestCount: z.number().int().min(0).max(100_000),
  city: z.string().min(1).max(120),
  budgetTotal: z.number().int().min(1).max(1_000_000_000),
  theme: z.string().max(120).optional(),
  venueStyle: z.string().max(120).optional(),
  cateringType: z.string().max(120).optional(),
  specialRequirements: z.string().max(2000).optional(),
  accessibilityNeeds: z.string().trim().min(1).max(500),
  ageMix: z.string().trim().min(1).max(120),
  eventDetails: z.record(z.string().max(80), z.string().max(500)).optional(),
  highlights: z.array(z.string().max(240)).length(4),
  timeline: z.array(z.object({
    time: z.string().min(1).max(40),
    task: z.string().min(1).max(160),
    owner: z.string().max(120),
    description: z.string().max(500).optional(),
    status: z.enum(["pending", "in_progress", "done", "cancelled"]),
    icon: z.string().max(80),
  })).length(12),
  budgetBreakdown: z.array(z.object({
    category: z.string().min(1).max(120),
    allocated: z.number().int().min(0).max(1_000_000_000),
    percentage: z.number().min(0).max(100),
    icon: z.string().max(80),
    notes: z.string().max(500).optional(),
  })).length(8),
  vendors: z.array(z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    status: z.enum(["pending", "contacted", "booked"]),
    priority: z.enum(["high", "medium", "low"]),
    icon: z.string().max(80),
    estimatedCost: z.string().max(120).optional(),
  })).length(10),
  checklist: z.array(z.object({
    task: z.string().min(1).max(160),
    dueDate: z.string().max(120),
    done: z.boolean(),
    icon: z.string().max(80),
    category: z.string().max(120).optional(),
  })).length(12),
});

const PlanDataSchema = z.object({
  eventType: z.string().trim().min(1).max(80).nullable(),
  eventDate: z.string().trim().min(1).max(40).nullable(),
  guestCount: z.string().trim().min(1).max(80).nullable(),
  city: z.string().trim().min(1).max(120).nullable(),
  budgetTotal: z.string().trim().min(1).max(80).nullable(),
  accessibilityNeeds: z.string().trim().min(1).max(500).nullable(),
  ageMix: z.string().trim().min(1).max(120).nullable(),
  theme: z.string().max(120).nullable(),
  venueStyle: z.string().max(120).nullable(),
  cateringType: z.string().max(120).nullable(),
  specialRequirements: z.string().max(500).nullable(),
  eventDetails: z.record(z.string().max(80), z.string().max(500).nullable()).optional(),
}).strict();

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(1200),
  })).max(30),
  generatePlan: z.boolean().optional(),
  planData: PlanDataSchema.optional(),
}).strict();

function isMissingDatabaseSchema(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "42703" || error.code === "42P01");
}

function isInsufficientAiCredits(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && error.status === 402;
}

// ─── Plan generation prompt ───────────────────────────────────────────────────
function buildPlanPrompt(d: z.infer<typeof PlanDataSchema>): string {
  const budgetTotal = parseBudget(d.budgetTotal ?? "");
  return `You are a professional event planner. Generate a complete, detailed event plan as JSON only (no markdown).

Event: ${d.eventType}, Date: ${d.eventDate}, Guests: ${d.guestCount}
City: ${d.city}, Budget: ${d.budgetTotal} (planning amount: ₹${budgetTotal}), Theme: ${d.theme ?? "Classic & Elegant"}
Venue: ${d.venueStyle ?? "TBD"}, Catering: ${d.cateringType ?? "TBD"}
Special: ${d.specialRequirements ?? "None"}
Accessibility and dietary needs: ${d.accessibilityNeeds}
Age mix: ${d.ageMix}
Occasion-specific details: ${JSON.stringify(d.eventDetails ?? {})}

Return ONLY this JSON structure:
{
  "eventType": "${d.eventType}",
  "eventDate": "${d.eventDate}",
  "guestCount": 100,
  "city": "${d.city}",
  "budgetTotal": ${budgetTotal},
  "theme": "${d.theme ?? "Classic & Elegant"}",
  "venueStyle": "${d.venueStyle ?? "Indoor"}",
  "cateringType": "${d.cateringType ?? "Both"}",
  "specialRequirements": "${d.specialRequirements ?? "None"}",
  "accessibilityNeeds": "${d.accessibilityNeeds}",
  "ageMix": "${d.ageMix}",
  "eventDetails": ${JSON.stringify(d.eventDetails ?? {})},
  "highlights": ["string1","string2","string3","string4"],
  "timeline": [{"time":"HH:MM AM/PM","task":"...","owner":"...","description":"...","status":"pending","icon":"lucide-name"}],
  "budgetBreakdown": [{"category":"...","allocated":0,"percentage":0,"icon":"lucide-name","notes":"..."}],
  "vendors": [{"name":"Generic service category","category":"...","description":"...","status":"pending","priority":"high","icon":"lucide-name","estimatedCost":"₹X–Y"}],
  "checklist": [{"task":"...","dueDate":"X weeks before","done":false,"icon":"lucide-name","category":"..."}]
}

Requirements:
- guestCount: parse "${d.guestCount}" to realistic integer (e.g. "50-100"→75, "Under 50"→30, "500+"→600)
- budgetTotal: use the exact planning amount ₹${budgetTotal}; do not recalculate it
- highlights: 4 exciting features specific to this event
- timeline: exactly 12 items covering full day from setup to wrap-up
- budgetBreakdown: exactly 8 categories, percentages sum to 100, amounts sum to budgetTotal
- vendors: exactly 10 generic vendor categories with planning descriptions and rough cost estimates; use names like "Wedding venue search" or "Local catering options", never invent a real business name, address, phone number, website, or claim a business is available
- You do not have live web search. Real local business listings are searched separately for the selected city; do not present generated vendor ideas as real businesses
- checklist: exactly 12 action items across categories: Venue, Catering, Entertainment, Decor, Guest Management, Documentation
- Accessibility needs: include concrete venue-access and seating tasks in the checklist and timeline. Account for step-free routes, wheelchair access, seating/rest areas for elderly guests, and any dietary restrictions provided. Do not invent needs the organizer did not mention.
- Age mix: tailor menu and activity suggestions in the catering/vendor descriptions, highlights, and checklist to "${d.ageMix}".
- Use occasion-specific details to tailor the timeline, vendors, checklist, and guest experience. For corporate events, account for the format, objective, duration, and AV/production needs; for weddings, account for ceremony traditions and personal moments.
- Make everything specific to ${d.eventType} in ${d.city} with ${d.theme} theme`;
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────
export async function POST(request: Request) {
  let messages: EventChatMessage[] = [];
  let generatingPlan = false;
  let failureStage = "request processing";
  try {
    const parsedBody = await parseJsonBody(request, ChatRequestSchema, 64 * 1024);
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const body = parsedBody.data;
    messages = body.messages;
    generatingPlan = Boolean(body.generatePlan && body.planData);

    // ── Plan generation mode ────────────────────────────────────────────────
    if (body.generatePlan && !body.planData) {
      return NextResponse.json({ error: "The complete event details are required to generate a plan." }, { status: 400 });
    }
    if (generatingPlan && body.planData) {
      const requiredFields = [
        body.planData.eventType,
        body.planData.eventDate,
        body.planData.guestCount,
        body.planData.city,
        body.planData.budgetTotal,
        body.planData.accessibilityNeeds,
        body.planData.ageMix,
      ];
      if (requiredFields.some((value) => !value?.trim())) {
        return NextResponse.json({ error: "Answer the accessibility and age-mix questions before generating your plan." }, { status: 400 });
      }
      if (!await consumeRateLimit(`llm:plan:${publicRateLimitIdentity(request)}`, 5)) {
        return NextResponse.json({ error: "You have reached the planning limit. Please wait a minute and try again." }, { status: 429 });
      }
      const user = authConfig.isConfigured ? await getAuthenticatedUser() : null;
      failureStage = "AI plan generation";
      const plan = await llmJson(
        "You are a professional event planner. Return a detailed plan that matches the exact JSON structure requested by the user.",
        [{ role: "user", content: buildPlanPrompt(body.planData) }],
        GeneratedPlanSchema,
        { maxTokens: 6000 },
      );
      plan.accessibilityNeeds = body.planData.accessibilityNeeds?.trim() || "Not specified";
      plan.ageMix = body.planData.ageMix?.trim() || "Not specified";
      plan.budgetTotal = parseBudget(body.planData.budgetTotal ?? "");
      plan.budgetBreakdown = normalizeBudgetAmounts(plan.budgetBreakdown, plan.budgetTotal);
      const runPlan = normalizePlanForRun(plan);
      failureStage = "contingency generation";
      const risks = await generateRisks(runPlan);
      failureStage = "saving the locked plan";
      const run = await saveLockedRun(runPlan, body.planData, risks, user?.id ?? null);
      return NextResponse.json({ plan: runPlan, run: { ...run, risks } });
    }

    return NextResponse.json(buildNextEventQuestion(messages));

  } catch (err) {
    console.error(`[${failureStage}] /api/chat`, err);
    if (generatingPlan) {
      const schemaOutdated = failureStage === "saving the locked plan"
        && isMissingDatabaseSchema(err);
      const insufficientCredits = isInsufficientAiCredits(err);
      const error = failureStage === "AI plan generation"
        ? "The AI could not finish a valid plan. Your answers are still here; please retry."
        : failureStage === "contingency generation"
          ? insufficientCredits
            ? "The AI service could not afford the Plan B response. Check your OpenRouter credits or choose a lower-cost model, then retry. Your answers are still here."
            : "The plan could not finish preparing its Plan B contingencies. Your answers are still here; please retry."
          : failureStage === "saving the locked plan"
            ? schemaOutdated
              ? "The database schema needs an update before plans can be saved. Run npm run db:migrate against the database configured for this app, then retry."
              : "The plan was generated but could not be saved. Check the database connection, then retry."
            : "Unable to generate the event plan. Your answers are still here; please retry.";
      return NextResponse.json({
        error,
      }, {
        status: failureStage === "AI plan generation"
          || failureStage === "contingency generation"
          || schemaOutdated
          || insufficientCredits
          ? 503
          : 500,
      });
    }
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      return NextResponse.json({ error: "The planning request is invalid or too long." }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to continue the event questions. Please try again." },
      { status: 500 },
    );
  }
}

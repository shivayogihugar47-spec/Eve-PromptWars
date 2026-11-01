import { z } from "zod";
import { llmJson } from "@/lib/llm";
import { isSyntheticFallbackRisk, OperationSchema, type PlanRisk, type RunPlan } from "./types";

const RiskSchema = z.object({
  risks: z.array(z.object({
    title: z.string().min(4).max(120).refine((title) => !isSyntheticFallbackRisk({ title })),
    triggerType: z.enum(["DELAY", "VENDOR_CANCELLED", "VENDOR_REPLACED", "GUEST_COUNT", "BUDGET", "DATE_MOVE", "VENUE_ISSUE", "WEATHER", "TASK_DONE"]),
    likelihood: z.enum(["low", "medium", "high"]),
    backupAction: z.array(OperationSchema).min(1).max(8),
  })).length(5),
});

export async function generateRisks(plan: RunPlan): Promise<PlanRisk[]> {
  const month = Number(plan.eventDate.slice(5, 7));
  const season = month >= 3 && month <= 5 ? "hot season"
    : month >= 6 && month <= 9 ? "monsoon"
    : month >= 10 && month <= 11 ? "post-monsoon"
    : "cool season";
  const outdoor = Boolean(plan.constraints?.outdoor)
    || /outdoor|garden|open air|beach|field/i.test(`${plan.venueStyle ?? ""} ${plan.theme ?? ""}`);
  const taskIds = new Set(plan.timeline.map((task) => task.id));
  const result = await llmJson(
    `You are a contingency planner. Return exactly five event-specific risks for this event. ` +
      `Consider event type, ${season}, ${outdoor ? "outdoor" : "indoor"} setting, guest count, and the actual scheduled tasks. ` +
      `Return JSON with exactly this shape: {"risks":[{"title":"specific risk","triggerType":"WEATHER","likelihood":"medium","backupAction":[{"type":"shift","taskId":"<exact task UUID>","minutes":15}]}]} ` +
      `Return exactly five risks. Each backupAction must contain 1-8 operation objects, with exact field names and JSON types. ` +
      `Allowed operations and exact shapes: ` +
      `shift={"type":"shift","taskId":"<exact task UUID>","minutes":15}; ` +
      `shorten={"type":"shorten","taskId":"<exact task UUID>","minutes":10}; ` +
      `parallelize={"type":"parallelize","taskId":"<exact task UUID>","withTaskId":"<exact task UUID>"}; ` +
      `drop={"type":"drop","taskId":"<exact task UUID>","reason":"..."}; ` +
      `swap_vendor={"type":"swap_vendor","taskId":"<exact task UUID>","vendorName":"...","costDelta":0}; ` +
      `reassign={"type":"reassign","taskId":"<exact task UUID>","owner":"..."}; ` +
      `add_task={"type":"add_task","task":"...","startAt":"2026-10-10T09:00:00.000Z","durationMin":15,"owner":"...","dependsOn":[]} . ` +
      `Task IDs must be copied exactly from the supplied task list, including UUID format. Numeric values must be JSON numbers, not strings. ` +
      `Prefer schedule adjustments grounded in the supplied task dependencies. Never invent task IDs, business names, ` +
      `vendor availability, booked services, or staff. Only name a replacement vendor if that exact vendor is explicitly ` +
      `listed as a confirmed alternative in the supplied event data. If a real alternative is not listed, provide an ` +
      `organizer action that requires confirming one instead of claiming it exists. Use one matching triggerType per risk.`,
    [{
      role: "user",
      content: JSON.stringify({
        eventType: plan.eventType,
        eventDate: plan.eventDate,
        season,
        outdoor,
        guestCount: plan.guestCount,
        venue: plan.venueStyle,
        tasks: plan.timeline.map(({ id, task, vendorName, owner, startAt, durationMin, dependsOn }) => ({
          id, task, vendorName, owner, startAt, durationMin, dependsOn,
        })),
        vendors: plan.vendors,
        constraints: plan.constraints,
      }),
    }],
    RiskSchema,
    { maxTokens: 3000 },
  );

  return result.risks.map((risk) => {
    if (isSyntheticFallbackRisk(risk)) {
      throw new Error(`The contingency "${risk.title}" was generic and not specific to this event.`);
    }
    const backupAction = risk.backupAction.filter((operation) =>
      operation.type === "add_task"
        ? operation.dependsOn.every((id) => taskIds.has(id))
        : taskIds.has(operation.taskId)
          && (operation.type !== "parallelize" || taskIds.has(operation.withTaskId)),
    );
    if (backupAction.length === 0) {
      throw new Error(`The contingency "${risk.title}" did not include a valid action for this plan.`);
    }
    return { ...risk, backupAction, status: "ready" as const };
  });
}

export function matchPreparedRisks(risks: PlanRisk[], triggerTypes: string[]): PlanRisk[] {
  const normalized = new Set(triggerTypes.map((type) => type.toUpperCase()));
  return risks.filter((risk) => risk.status !== "dismissed" && normalized.has(risk.triggerType));
}

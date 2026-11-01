import { z } from "zod";
import { llmJson } from "@/lib/llm";
import { matchPreparedRisks } from "./risks";
import { OperationSchema, type ImpactReport, type PlanRisk, type RunChange, type RunOption, type RunPlan } from "./types";

const OptionsSchema = z.object({
  options: z.array(z.object({
    title: z.string().min(4).max(120),
    operations: z.array(OperationSchema).min(1).max(12),
    tradeoffs: z.array(z.string().max(240)).min(1).max(5),
    rupeeImpact: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  })).min(2).max(3),
});

const optionsPrompt =
  `You are an event operations option generator. Return exactly 2 or 3 ranked alternatives as ` +
  `{"options":[{"title":"...","operations":[...],"tradeoffs":["..."],"rupeeImpact":0}]}. ` +
  `Every option must have 1–12 operations and 1–5 tradeoffs. rupeeImpact must be a signed integer in INR. ` +
  `Use only these exact operation shapes, with task IDs copied from the supplied plan: ` +
  `shift={"type":"shift","taskId":"<uuid>","minutes":15}; ` +
  `shorten={"type":"shorten","taskId":"<uuid>","minutes":10}; ` +
  `parallelize={"type":"parallelize","taskId":"<uuid>","withTaskId":"<uuid>"}; ` +
  `drop={"type":"drop","taskId":"<uuid>","reason":"..."}; ` +
  `swap_vendor={"type":"swap_vendor","taskId":"<uuid>","vendorName":"...","costDelta":0}; ` +
  `reassign={"type":"reassign","taskId":"<uuid>","owner":"..."}; ` +
  `add_task={"type":"add_task","task":"...","startAt":"<ISO datetime>","durationMin":15,"owner":"...","dependsOn":[]} . ` +
  `Do not add fields to these shapes. Never edit the plan directly. Respect dependencies, hard constraints, ` +
  `the budget, and organizer priorities. Include plain-language tradeoffs.`;

function validationIssues(error: z.ZodError): string {
  return error.issues.map((issue) =>
    `${issue.path.join(".") || "response"}: ${issue.message}`,
  ).join("; ");
}

export async function generateOptions(input: {
  plan: RunPlan;
  changes: RunChange[];
  impact: ImpactReport;
  risks: PlanRisk[];
  priorities: string[];
  constraints: string[];
  retryReasons?: string[];
  usePrepared?: boolean;
}): Promise<RunOption[]> {
  const prepared = input.usePrepared === false ? [] : matchPreparedRisks(input.risks, input.changes.map((change) => change.type));
  if (prepared.length > 0) {
    return [{
      title: `Plan B ready: ${prepared[0].title}`,
      operations: prepared[0].backupAction,
      tradeoffs: ["Uses the contingency prepared for this event."],
      rupeeImpact: 0,
      source: "prepared",
    }];
  }

  const retryContext = input.retryReasons?.length
    ? ` Previous options failed verification: ${input.retryReasons.join("; ")}. Correct these failures.`
    : "";
  const messages = [{
      role: "user" as const,
      content: JSON.stringify({
        plan: input.plan,
        changes: input.changes,
        impact: input.impact,
        priorities: input.priorities,
        constraints: input.constraints,
      }),
    }];
  let result: z.infer<typeof OptionsSchema>;
  try {
    result = await llmJson(`${optionsPrompt}${retryContext}`, messages, OptionsSchema);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    console.warn("[RUN options] Model output failed schema validation; retrying with validation details.", error.issues);
    result = await llmJson(
      `${optionsPrompt}${retryContext} The previous response failed validation: ${validationIssues(error)}. ` +
        `Correct those exact issues. Return only the required JSON object.`,
      messages,
      OptionsSchema,
    );
  }
  return result.options.map((option) => ({ ...option, source: "generated" as const }));
}

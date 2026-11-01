import { z } from "zod";
import { llmJson } from "@/lib/llm";
import { ChangeSchema, type RunChange, type RunPlan } from "./types";

const IntakeSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || !("changes" in value) || !Array.isArray(value.changes)) return value;
  const normalizeNumber = (raw: unknown, field: string): unknown => {
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string") return raw;
    const text = raw.trim();
    if (field === "minutes") {
      const hoursAndMinutes = text.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)$/i);
      if (hoursAndMinutes) return Math.round(Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2]));
      const duration = text.match(/^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)?$/i);
      if (duration) {
        const amount = Number(duration[1]);
        return /^(?:hours?|hrs?|h)$/i.test(duration[2] ?? "") ? Math.round(amount * 60) : Math.round(amount);
      }
      if (/^(?:half\s+an?\s+hour|an?\s+hour)$/i.test(text)) return /^half/i.test(text) ? 30 : 60;
      return raw;
    }
    const amount = text.match(/^\s*(?:₹|Rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)/i)?.[1];
    return amount ? Math.round(Number(amount.replace(/,/g, ""))) : raw;
  };

  return {
    ...value,
    changes: value.changes.map((change: unknown) => {
      if (!change || typeof change !== "object") return change;
      const fields = ["minutes", "guestCount", "budgetTotal"] as const;
      const normalized = { ...change } as Record<string, unknown>;
      for (const field of fields) {
        if (field in normalized) normalized[field] = normalizeNumber(normalized[field], field);
      }
      return normalized;
    }),
  };
}, z.object({
  changes: z.array(ChangeSchema).max(8),
  clarifyingQuestion: z.string().max(240).nullable(),
}));

const taskAliases: Record<string, string> = {
  caterer: "cater",
  caterers: "cater",
  catering: "cater",
  photographer: "photo",
  photographers: "photo",
  photography: "photo",
  decorator: "decor",
  decorators: "decor",
  decoration: "decor",
  florist: "flower",
  florists: "flower",
  floral: "flower",
};

const ignoredTaskWords = new Set([
  "a", "an", "and", "are", "at", "by", "called", "for", "from", "is", "late",
  "minutes", "min", "mins", "hour", "hours", "hr", "hrs", "the", "was", "were",
  "will", "with", "delayed", "delay", "behind", "schedule", "running", "called",
]);

function taskTerms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z]+/g)?.flatMap((word) => {
    if (ignoredTaskWords.has(word)) return [];
    return [taskAliases[word] ?? word.replace(/s$/, "")];
  }) ?? []);
}

function findTaskMatches(query: string, plan: RunPlan): RunPlan["timeline"] {
  const queryTerms = taskTerms(query);
  if (queryTerms.size === 0) return [];
  const scored = plan.timeline.map((task) => {
    const taskTermsSet = taskTerms(`${task.task} ${task.vendorName ?? ""} ${task.owner}`);
    const score = Array.from(queryTerms).filter((term) => taskTermsSet.has(term)).length;
    return { task, score };
  }).filter(({ score }) => score > 0);
  if (scored.length === 0) return [];
  const bestScore = Math.max(...scored.map(({ score }) => score));
  return scored.filter(({ score }) => score === bestScore).map(({ task }) => task);
}

function parseSimpleDelay(text: string, plan: RunPlan): {
  changes: RunChange[];
  clarifyingQuestion: string | null;
} | null {
  if (!/\b(?:late|delayed|running late|behind schedule|behind by)\b/i.test(text)) return null;
  if (/\b(?:guests?|people|attendees?|budget|cost|rain|weather|cancel(?:led|ed)?|replace|date|move|venue|done|finished|complete)\b/i.test(text)) {
    return null;
  }

  const durationMatches = Array.from(text.matchAll(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi));
  if (durationMatches.length !== 1) return null;
  const amount = Number(durationMatches[0][1]);
  const unit = durationMatches[0][2];
  const minutes = Math.round(/^(?:hours?|hrs?|h)$/i.test(unit) ? amount * 60 : amount);
  if (minutes < 1 || minutes > 1440) return null;

  const matches = findTaskMatches(text, plan);
  if (matches.length === 1) {
    const task = matches[0];
    return {
      changes: [{ type: "DELAY", taskId: task.id, minutes, note: `${task.task} is delayed by ${minutes} minutes` }],
      clarifyingQuestion: null,
    };
  }
  if (matches.length > 1) {
    return {
      changes: [],
      clarifyingQuestion: `Which task is delayed: ${matches.slice(0, 3).map((task) => task.task).join(", ")}?`,
    };
  }
  return null;
}

function resolveTaskTargets(changes: RunChange[], plan: RunPlan): string | null {
  const tasksById = new Map(plan.timeline.map((task) => [task.id, task]));
  for (const change of changes) {
    const needsTask = ["DELAY", "VENDOR_CANCELLED", "VENDOR_REPLACED", "TASK_DONE"].includes(change.type);
    if (!needsTask) continue;

    if (change.taskId) {
      if (tasksById.has(change.taskId)) continue;
      return "I couldn't match that update to a task in this plan. Which task did you mean?";
    }

    const query = change.taskName ?? change.vendorName;
    const matches = query ? findTaskMatches(query, plan) : [];
    if (matches.length === 1) {
      change.taskId = matches[0].id;
      continue;
    }
    if (matches.length > 1) {
      return `Which task did you mean: ${matches.slice(0, 3).map((task) => task.task).join(", ")}?`;
    }
    return "Which task or vendor should I update?";
  }
  return null;
}

const quickChanges: Record<string, (plan: RunPlan) => RunChange> = {
  "delay-15": (plan) => ({ type: "DELAY", taskId: nextTaskId(plan), minutes: 15, note: "Quick update: delayed 15 minutes" }),
  "delay-30": (plan) => ({ type: "DELAY", taskId: nextTaskId(plan), minutes: 30, note: "Quick update: delayed 30 minutes" }),
  "task-done": () => ({ type: "TASK_DONE", note: "Task marked complete by organizer" }),
  "vendor-cancelled": () => ({ type: "VENDOR_CANCELLED", note: "Vendor cancelled" }),
  "more-guests": (plan) => ({ type: "GUEST_COUNT", guestCount: plan.guestCount + 10, note: "More guests are attending" }),
  rain: () => ({ type: "WEATHER", note: "Rain reported" }),
  "venue-issue": () => ({ type: "VENUE_ISSUE", note: "Venue issue reported" }),
};

function nextTaskId(plan: RunPlan): string | undefined {
  return plan.timeline.find((task) => task.status !== "done" && task.status !== "cancelled")?.id;
}

export function parseQuickChange(action: string, plan: RunPlan): RunChange | null {
  const create = quickChanges[action];
  if (!create) return null;
  const change = create(plan);
  return ChangeSchema.parse(change);
}

export async function parseChangeText(text: string, plan: RunPlan): Promise<{
  changes: RunChange[];
  clarifyingQuestion: string | null;
}> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Tell Eve what changed before submitting.");
  if (trimmed.length > 1200) throw new Error("Keep the update under 1,200 characters.");

  const mentionsDelay = /\b(?:late|delayed|running behind|behind schedule)\b/i.test(trimmed);
  const includesDuration = /\b\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b/i.test(trimmed);
  if (mentionsDelay && !includesDuration) {
    const subjectMatch = trimmed.match(/\b(.{1,60}?)\s+(?:is|are|was|were|will be)\s+(?:hours?|late|delayed|running behind)\b/i);
    const subject = subjectMatch?.[1].replace(/^(?:the|our|my)\s+/i, "").trim();
    return {
      changes: [],
      clarifyingQuestion: subject
        ? `How many minutes late is ${subject}?`
        : "Which task is delayed, and by how many minutes?",
    };
  }

  const simpleDelay = parseSimpleDelay(trimmed, plan);
  if (simpleDelay) return simpleDelay;

  const taskContext = plan.timeline.map((task) => ({
    id: task.id,
    task: task.task,
    vendor: task.vendorName ?? null,
    owner: task.owner,
    time: task.startAt,
    status: task.status,
  }));
  let parsed: z.infer<typeof IntakeSchema>;
  try {
    parsed = IntakeSchema.parse(await llmJson(
      `Read the organizer's message as everyday, simple English. Accept short phrases, imperfect grammar, ` +
        `contractions, and common spelling variations. Identify what changed; do not require formal wording. ` +
        `Return {"changes":[...],"clarifyingQuestion":null} when the meaning is clear. ` +
        `Use only these change types: DELAY, VENDOR_CANCELLED, VENDOR_REPLACED, GUEST_COUNT, BUDGET, DATE_MOVE, VENUE_ISSUE, WEATHER, TASK_DONE. ` +
        `A single message can contain multiple separate changes; include every clear change. ` +
        `DELAY needs taskId and minutes. For relative phrases like "30 more guests", add 30 to the current guest count. ` +
        `Match task/vendor names by meaning (for example "caterer" can refer to a task named "Catering setup"). ` +
        `Copy a matching task id exactly from the task list; if it is unclear which task matches, use taskName and ask one question. ` +
        `Convert duration units to integer minutes (1 hour = 60), amounts to integer INR, dates to YYYY-MM-DD, and closing times to 24-hour HH:mm. ` +
        `For "one hour earlier", subtract 60 minutes from a known current closing time; ask if that time is not in the plan. ` +
        `Examples: "Caterer is late by 40 minutes" -> one DELAY for the matching catering task, minutes 40. ` +
        `"Photographer cancelled" -> VENDOR_CANCELLED for the matching photography task. ` +
        `"30 more guests are coming" -> GUEST_COUNT with current guestCount + 30. ` +
        `"Rain is coming and the event is outside" -> WEATHER. ` +
        `If a required detail is genuinely missing or two tasks are equally plausible, ask exactly one short question and return changes as []. ` +
        `Do not invent numbers, task ids, dates, or business names. Do not edit the plan or suggest solutions.`,
      [
        {
          role: "user",
          content: `Event context: ${JSON.stringify({
            eventType: plan.eventType,
            eventDate: plan.eventDate,
            guestCount: plan.guestCount,
            budgetTotal: plan.budgetTotal,
            constraints: plan.constraints ?? {},
          })}\nTasks (use ids exactly as shown): ${JSON.stringify(taskContext)}\n\nOrganizer update: ${trimmed}`,
        },
      ],
      IntakeSchema,
    ));
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    console.warn("[RUN intake] LLM returned changes that failed validation; asking organizer to clarify.", error.issues);
    return {
      changes: [],
      clarifyingQuestion: "I couldn't safely map that update to the plan. Which task changed, and what should be different?",
    };
  }

  const changes = parsed.changes.map((change) => ChangeSchema.parse(change));
  const targetQuestion = resolveTaskTargets(changes, plan);
  if (parsed.clarifyingQuestion || targetQuestion) {
    return { changes: [], clarifyingQuestion: parsed.clarifyingQuestion ?? targetQuestion };
  }
  if (changes.length === 0 && !parsed.clarifyingQuestion) {
    return { changes: [], clarifyingQuestion: "What changed? For example, tell me which task is late and by how long." };
  }
  return { changes, clarifyingQuestion: parsed.clarifyingQuestion, };
}

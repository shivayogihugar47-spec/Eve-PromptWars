import { z } from "zod";
import type { EventPlan, TimelineItem } from "@/app/api/chat/route";

export const CHANGE_TYPES = [
  "DELAY",
  "VENDOR_CANCELLED",
  "VENDOR_REPLACED",
  "GUEST_COUNT",
  "BUDGET",
  "DATE_MOVE",
  "VENUE_ISSUE",
  "WEATHER",
  "TASK_DONE",
] as const;

export const ChangeSchema = z.object({
  type: z.enum(CHANGE_TYPES),
  taskId: z.string().uuid().optional(),
  taskName: z.string().max(160).optional(),
  minutes: z.number().int().min(1).max(1440).optional(),
  guestCount: z.number().int().min(0).max(100_000).optional(),
  budgetTotal: z.number().int().min(1).max(1_000_000_000).optional(),
  eventDate: z.string().date().optional(),
  vendorName: z.string().max(120).optional(),
  replacementVendor: z.string().max(120).optional(),
  venueClosesAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  actualAt: z.string().datetime().optional(),
  note: z.string().max(300).optional(),
});

export type RunChange = z.infer<typeof ChangeSchema>;

export const OperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shift"), taskId: z.string().uuid(), minutes: z.number().int().min(-1440).max(1440) }),
  z.object({ type: z.literal("shorten"), taskId: z.string().uuid(), minutes: z.number().int().min(1).max(1440) }),
  z.object({ type: z.literal("parallelize"), taskId: z.string().uuid(), withTaskId: z.string().uuid() }),
  z.object({ type: z.literal("drop"), taskId: z.string().uuid(), reason: z.string().max(240) }),
  z.object({ type: z.literal("swap_vendor"), taskId: z.string().uuid(), vendorName: z.string().min(1).max(120), costDelta: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(0) }),
  z.object({ type: z.literal("reassign"), taskId: z.string().uuid(), owner: z.string().min(1).max(120) }),
  z.object({ type: z.literal("add_task"), task: z.string().min(1).max(160), startAt: z.string().datetime(), durationMin: z.number().int().min(1).max(1440), owner: z.string().max(120).default("Unassigned"), dependsOn: z.array(z.string().uuid()).default([]) }),
]);

export type RunOperation = z.infer<typeof OperationSchema>;

export interface RunTask extends TimelineItem {
  id: string;
  startAt: string;
  durationMin: number;
  dependsOn: string[];
  vendorName?: string;
  actualAt?: string;
}

export interface RunPlan extends Omit<EventPlan, "timeline"> {
  timeline: RunTask[];
  constraints?: {
    venueClosesAt?: string;
    eventEndsAt?: string;
    outdoor?: boolean;
    vendorWindows?: Record<string, { startAt: string; endAt: string }>;
  };
}

export interface PlanRisk {
  id?: string;
  title: string;
  triggerType: RunChange["type"];
  likelihood: "low" | "medium" | "high";
  backupAction: RunOperation[];
  status?: "ready" | "triggered" | "resolved" | "dismissed";
}

export function isSyntheticFallbackRisk(risk: Pick<PlanRisk, "title">): boolean {
  return /^(?:Delay affecting .+|Vendor cancellation for .+|Guest surge beyond \d+ attendees|(?:Rain plan for outdoor event|Weather disruption plan) near .+|Venue access issue affecting .+)$/i
    .test(risk.title);
}

export interface ImpactViolation {
  type: "dependency" | "venue_close" | "vendor_window" | "event_end" | "budget";
  taskId?: string;
  message: string;
}

export interface ImpactReport {
  affectedTasks: { id: string; task: string; reason: string }[];
  newTimes: { taskId: string; before: string; after: string }[];
  criticalPath: string[];
  slackMinutes: Record<string, number>;
  budgetDelta: number;
  violations: ImpactViolation[];
  severity: "low" | "medium" | "high";
}

export interface RunOption {
  title: string;
  operations: RunOperation[];
  tradeoffs: string[];
  rupeeImpact: number;
  source: "prepared" | "generated" | "deterministic";
}

export interface VerifiedOption extends RunOption {
  report: ImpactReport;
  plan: RunPlan;
}

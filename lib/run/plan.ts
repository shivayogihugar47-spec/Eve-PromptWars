import type { EventPlan, TimelineItem } from "@/app/api/chat/route";
import type { RunPlan, RunTask } from "./types";

function parseStart(eventDate: string, value: string, index: number): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? eventDate : new Date().toISOString().slice(0, 10);
  const match = value.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return new Date(Date.parse(`${date}T09:00:00Z`) + index * 30 * 60_000).toISOString();
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3]?.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[3]?.toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000).toISOString();
}

function startLabel(startAt: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(startAt));
}

export function normalizePlanForRun(plan: EventPlan): RunPlan {
  const starts = plan.timeline.map((item, index) => {
    const enriched = item as TimelineItem & { id?: string; startAt?: string; durationMin?: number; dependsOn?: string[] };
    return {
      ...item,
      id: enriched.id ?? crypto.randomUUID(),
      startAt: enriched.startAt ?? parseStart(plan.eventDate, item.time, index),
      durationMin: enriched.durationMin ?? 30,
      dependsOn: enriched.dependsOn ?? [],
    };
  });
  const timeline: RunTask[] = starts.map((task, index) => {
    const nextTask = starts[index + 1];
    const gap = nextTask ? (Date.parse(nextTask.startAt) - Date.parse(task.startAt)) / 60_000 : 30;
    const suppliedDependencies = task.dependsOn;
    const dependsOn = suppliedDependencies.length > 0
      ? suppliedDependencies
      : index > 0 ? [starts[index - 1].id] : [];
    const durationMin = task.durationMin === 30 && gap > 0 && gap <= 240
      ? Math.max(1, Math.round(gap))
      : task.durationMin;
    return {
      ...task,
      time: startLabel(task.startAt),
      durationMin,
      dependsOn,
      status: task.status ?? "pending",
    };
  });
  const eventEnd = Math.max(...timeline.map((task) => Date.parse(task.startAt) + task.durationMin * 60_000));
  const venueText = `${plan.venueStyle ?? ""} ${plan.theme ?? ""}`;

  return {
    ...plan,
    timeline,
    constraints: {
      outdoor: /outdoor|garden|open air|beach|field/i.test(venueText),
      eventEndsAt: new Date(eventEnd).toISOString(),
    },
  };
}

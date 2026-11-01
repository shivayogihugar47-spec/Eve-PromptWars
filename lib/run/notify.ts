import { z } from "zod";
import { sql } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import type { RunChange, RunPlan } from "./types";

const DraftSchema = z.object({
  messages: z.array(z.object({
    taskId: z.string().uuid(),
    message: z.string().min(1).max(500),
  })).max(40),
});

export async function draftOwnerNotifications(
  eventId: string,
  plan: RunPlan,
  changes: RunChange[],
  affectedTaskIds: string[],
): Promise<{ taskId: string; owner: string; phone: string | null; message: string; whatsappUrl: string | null }[]> {
  const taskIds = Array.from(new Set(affectedTaskIds));
  if (taskIds.length === 0) return [];
  const tasks = plan.timeline.filter((task) => taskIds.includes(task.id));
  const result = await llmJson(
    "Write one concise, WhatsApp-ready operational message for each affected event task. State its new time, what changed, and what the owner should do next. Stay under 60 words per message. Do not send messages.",
    [{
      role: "user",
      content: JSON.stringify({
        changes,
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.task,
          owner: task.owner,
          newTime: task.time,
          vendor: task.vendorName,
        })),
      }),
    }],
    DraftSchema,
  );
  const taskRows = await sql`SELECT id, owner_name, owner_phone FROM tasks
    WHERE event_id = ${eventId} AND id = ANY(${taskIds}::uuid[])`;
  const taskInfo = new Map(taskRows.map((row) => [String(row.id), row]));
  return result.messages.flatMap((draft) => {
    const task = tasks.find((entry) => entry.id === draft.taskId);
    if (!task) return [];
    const row = taskInfo.get(draft.taskId);
    const phone = row?.owner_phone ? String(row.owner_phone) : null;
    const phoneDigits = phone?.replace(/\D/g, "");
    const whatsappUrl = `https://wa.me/${phoneDigits ?? ""}?text=${encodeURIComponent(draft.message)}`;
    return [{
      taskId: task.id,
      owner: String(row?.owner_name ?? task.owner),
      phone,
      message: draft.message,
      whatsappUrl,
    }];
  });
}

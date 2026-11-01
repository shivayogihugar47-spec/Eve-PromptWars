import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import { consumeRateLimit, loadOwnedOrganizerRun, rateLimitIdentity } from "@/lib/run/security";
import { RunApiError } from "@/lib/run/apply";
import { isUuid, parseJsonBody } from "@/lib/apiRequest";

const LessonsSchema = z.object({
  lessons: z.array(z.string().min(4).max(240)).min(2).max(5),
});
const TemplateSchema = z.object({ name: z.string().trim().min(2).max(80) });
type RouteContext = { params: Promise<{ eventId: string }> };

async function buildSummary(eventId: string, request: Request) {
  const run = await loadOwnedOrganizerRun(request, eventId);
  const [taskRows, expenseRows, budgetRows, changeRows] = await Promise.all([
    sql`SELECT title, start_time, end_time, actual_end_time, status
      FROM tasks WHERE event_id = ${eventId} ORDER BY start_time`,
    sql`SELECT COALESCE(SUM(amount), 0) AS actual FROM expenses WHERE event_id = ${eventId}`,
    sql`SELECT COALESCE(SUM(actual), 0) AS actual FROM budget_items WHERE event_id = ${eventId}`,
    sql`SELECT type, payload, created_at FROM plan_events
      WHERE event_id = ${eventId} AND type NOT IN ('LOCKED', 'APPLIED', 'NOTIFY', 'NOTIFY_FAILED')
      ORDER BY created_at`,
  ]);
  const expenseActual = Number(expenseRows[0]?.actual ?? 0);
  const actualBudget = expenseActual > 0 ? expenseActual : Number(budgetRows[0]?.actual ?? 0);
  const tasksOnTime = taskRows.filter((task) =>
    task.status === "done" && task.actual_end_time
      && Date.parse(String(task.actual_end_time)) <= Date.parse(String(task.end_time)),
  ).length;
  const tasksDelayed = taskRows.filter((task) =>
    task.status === "done" && task.actual_end_time
      && Date.parse(String(task.actual_end_time)) > Date.parse(String(task.end_time)),
  ).length;
  const core = {
    plannedBudget: run.plan.budgetTotal,
    actualBudget,
    tasksOnTime,
    tasksDelayed,
    tasksPending: taskRows.filter((task) => task.status !== "done" && task.status !== "cancelled").length,
    changesHandled: changeRows.length,
    changes: changeRows.map((entry) => ({ type: entry.type, payload: entry.payload, at: entry.created_at })),
  };
  const lessons = await llmJson(
    "Summarize practical lessons learned from the event run. Return 2 to 5 short, constructive, specific points. Do not invent facts.",
    [{ role: "user", content: JSON.stringify({ eventType: run.plan.eventType, city: run.plan.city, summary: core }) }],
    LessonsSchema,
  );
  return { ...core, lessons: lessons.lessons };
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  try {
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:summary`, 6)) {
      return NextResponse.json({ error: "Too many summary requests. Try again shortly." }, { status: 429 });
    }
    return NextResponse.json(await buildSummary(eventId, request));
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[/api/run summary]", error);
    return NextResponse.json({ error: "Unable to prepare the event summary. Your event data is safe; please retry." }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  try {
    const parsedBody = await parseJsonBody(request, TemplateSchema, 2 * 1024);
    if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    const body = parsedBody.data;
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:template`, 3)) {
      return NextResponse.json({ error: "Too many template requests. Try again shortly." }, { status: 429 });
    }
    const run = await loadOwnedOrganizerRun(request, eventId);
    const structure = {
      eventType: run.plan.eventType,
      theme: run.plan.theme,
      venueStyle: run.plan.venueStyle,
      cateringType: run.plan.cateringType,
      timeline: run.plan.timeline.map(({ task, time, durationMin, dependsOn, owner, icon }) =>
        ({ task, time, durationMin, dependsOn, owner, icon })),
      budgetBreakdown: run.plan.budgetBreakdown.map(({ category, percentage, icon }) => ({ category, percentage, icon })),
    };
    const inserted = await sql`INSERT INTO event_templates (event_id, name, structure)
      VALUES (${eventId}, ${body.name}, ${JSON.stringify(structure)}::jsonb) RETURNING id`;
    await sql`INSERT INTO plan_events (event_id, type, payload, actor)
      VALUES (${eventId}, 'TEMPLATE_SAVED', ${JSON.stringify({ templateId: inserted[0].id, name: body.name })}::jsonb, 'organizer')`;
    return NextResponse.json({ templateId: inserted[0].id, name: body.name }, { status: 201 });
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Give the template a name (2–80 characters)." }, { status: 400 });
    console.error("[/api/run template]", error);
    return NextResponse.json({ error: "Unable to save this template. Please retry." }, { status: 503 });
  }
}

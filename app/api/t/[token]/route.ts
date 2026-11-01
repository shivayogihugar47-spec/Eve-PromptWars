import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { analyzeImpact, applyChanges } from "@/lib/run/impact";
import { applySelectedProposal, commitPlanVersion, RunApiError } from "@/lib/run/apply";
import { generateOptions } from "@/lib/run/options";
import { verifyOptions } from "@/lib/run/verify";
import { ChangeSchema, type PlanRisk } from "@/lib/run/types";
import { consumeRateLimit, loadOwnerRun } from "@/lib/run/security";
import { draftOwnerNotifications } from "@/lib/run/notify";
import { createHash } from "node:crypto";
import { parseJsonBody } from "@/lib/apiRequest";

type RouteContext = { params: Promise<{ token: string }> };

const OwnerActionSchema = z.object({
  action: z.enum(["done", "delay-15", "delay-30"]),
  taskId: z.string().uuid(),
  version: z.number().int().positive(),
  proposalId: z.string().uuid().optional(),
  optionIndex: z.number().int().min(0).max(2).optional(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
});

function tokenBucket(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return NextResponse.json({ error: "This owner link is invalid or has expired." }, { status: 404 });
    }
    if (!await consumeRateLimit(`owner:${tokenBucket(token)}:poll`, 40)) {
      return NextResponse.json({ error: "Too many refreshes. Try again shortly." }, { status: 429 });
    }
    const owner = await loadOwnerRun(token);
    const ownTasks = owner.plan.timeline.filter((task) => owner.taskIds.includes(task.id));
    return NextResponse.json({
      eventId: owner.eventId,
      version: owner.version,
      eventType: owner.plan.eventType,
      eventDate: owner.plan.eventDate,
      tasks: ownTasks.map(({ id, task, time, startAt, durationMin, owner: taskOwner, status }) => ({
        id, task, time, startAt, durationMin, owner: taskOwner, status,
      })),
    });
  } catch (error) {
    console.error("[/api/t GET]", error);
    return NextResponse.json({ error: "This owner link is invalid or has expired." }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return NextResponse.json({ error: "This owner link is invalid or has expired." }, { status: 404 });
    }
    if (!await consumeRateLimit(`owner:${tokenBucket(token)}:action`, 12)) {
      return NextResponse.json({ error: "Too many task updates. Try again shortly." }, { status: 429 });
    }
    const owner = await loadOwnerRun(token);
    const parsedBody = await parseJsonBody(request, OwnerActionSchema, 4 * 1024);
    if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    const body = parsedBody.data;
    if (!owner.taskIds.includes(body.taskId)) throw new RunApiError("This task is not assigned to this owner link.", 403);
    if (owner.version !== body.version) {
      return NextResponse.json({ error: "The schedule changed. Refresh before updating this task.", stale: true }, { status: 409 });
    }
    const task = owner.plan.timeline.find((entry) => entry.id === body.taskId);
    if (!task) throw new RunApiError("Task not found.", 404);
    const change = ChangeSchema.parse(body.action === "done"
      ? { type: "TASK_DONE", taskId: body.taskId, actualAt: new Date().toISOString(), note: "Owner marked task done" }
      : { type: "DELAY", taskId: body.taskId, minutes: body.action === "delay-15" ? 15 : 30, note: `Owner requested ${body.action === "delay-15" ? 15 : 30} minute delay` });

    if (body.proposalId && body.optionIndex !== undefined) {
      const proposalRows = await sql`SELECT payload FROM run_proposals
        WHERE id = ${body.proposalId} AND event_id = ${owner.eventId} AND source_version = ${owner.version} AND expires_at > now() LIMIT 1`;
      const proposalChanges = (proposalRows[0]?.payload as { changes?: { taskId?: string }[] } | undefined)?.changes;
      if (!proposalChanges?.length || proposalChanges.some((entry) => !entry.taskId || !owner.taskIds.includes(entry.taskId))) {
        throw new RunApiError("This change is not available through your owner link.", 403);
      }
      const result = await applySelectedProposal({
        run: owner,
        eventId: owner.eventId,
        proposalId: body.proposalId,
        optionIndex: body.optionIndex,
        expectedVersion: body.version,
        idempotencyKey: body.idempotencyKey,
        actor: "task-owner",
      });
      const notifications = await draftOwnerNotifications(
        owner.eventId,
        result.plan,
        [change],
        result.option.report.affectedTasks.map((entry) => entry.id),
      );
      await sql`INSERT INTO plan_events (event_id, type, payload, actor)
        VALUES (${owner.eventId}, 'NOTIFY', ${JSON.stringify({ version: result.version, taskIds: notifications.map((entry) => entry.taskId) })}::jsonb, 'system')`;
      return NextResponse.json({
        version: result.version,
        tasks: result.plan.timeline.filter((entry) => owner.taskIds.includes(entry.id)),
        notifications,
      });
    }

    await sql`INSERT INTO plan_events (event_id, type, payload, actor)
      VALUES (${owner.eventId}, ${change.type}, ${JSON.stringify(change)}::jsonb, 'task-owner')`;

    if (change.type === "TASK_DONE") {
      const nextPlan = applyChanges(owner.plan, [change]);
      const result = await commitPlanVersion({
        eventId: owner.eventId,
        expectedVersion: owner.version,
        idempotencyKey: body.idempotencyKey,
        plan: nextPlan,
        changes: [change],
        note: `Task completed: ${task.task}`,
        actor: "task-owner",
      });
      return NextResponse.json({
        version: result.version,
        tasks: result.plan.timeline.filter((entry) => owner.taskIds.includes(entry.id)),
      });
    }

    const impact = analyzeImpact(owner.plan, [change]);
    const riskRows = await sql`SELECT id, title, trigger_type, likelihood, backup_action, status
      FROM risks WHERE event_id = ${owner.eventId} AND status IN ('ready', 'triggered')`;
    const risks: PlanRisk[] = riskRows.map((risk) => ({
      id: String(risk.id),
      title: String(risk.title),
      triggerType: String(risk.trigger_type) as PlanRisk["triggerType"],
      likelihood: String(risk.likelihood) as PlanRisk["likelihood"],
      backupAction: risk.backup_action as PlanRisk["backupAction"],
      status: risk.status as PlanRisk["status"],
    }));
    const options = await generateOptions({
      plan: owner.plan,
      changes: [change],
      impact,
      risks,
      priorities: [],
      constraints: [],
    });
    const verified = verifyOptions(owner.plan, [change], impact, options);
    if (verified.verified.length === 0) {
      throw new RunApiError("I couldn't find a safe schedule adjustment. The schedule is unchanged.", 422);
    }
    const payload = {
      changes: [change],
      impact,
      options: verified.verified.map(({ title, operations, tradeoffs, rupeeImpact, source }) => ({ title, operations, tradeoffs, rupeeImpact, source })),
      verified: verified.verified,
    };
    const proposal = await sql`INSERT INTO run_proposals (event_id, source_version, payload)
      VALUES (${owner.eventId}, ${owner.version}, ${JSON.stringify(payload)}::jsonb) RETURNING id`;
    return NextResponse.json({
      proposalId: proposal[0].id,
      version: owner.version,
      changes: [change],
      impact,
      options: verified.verified.map(({ plan, report, ...option }) => ({ ...option, report, plan })),
    });
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "That task update is invalid." }, { status: 400 });
    console.error("[/api/t POST]", error);
    return NextResponse.json({ error: "Unable to update the task. Please retry; your selection is still available." }, { status: 503 });
  }
}

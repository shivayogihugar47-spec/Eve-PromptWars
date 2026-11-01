import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { analyzeImpact, applyChanges } from "@/lib/run/impact";
import { parseChangeText, parseQuickChange } from "@/lib/run/intake";
import { generateOptions } from "@/lib/run/options";
import { verifyOptions, deterministicShiftOption } from "@/lib/run/verify";
import { consumeRateLimit, loadOwnedOrganizerRun, rateLimitIdentity } from "@/lib/run/security";
import type { PlanRisk, RunChange, RunOption } from "@/lib/run/types";
import { commitPlanVersion, RunApiError } from "@/lib/run/apply";
import { isUuid, parseJsonBody } from "@/lib/apiRequest";

const RequestSchema = z.object({
  version: z.number().int().positive(),
  text: z.string().max(1200).optional(),
  action: z.enum(["delay-15", "delay-30", "task-done", "vendor-cancelled", "more-guests", "rain", "venue-issue"]).optional(),
  taskId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).refine((value) => Boolean(value.text?.trim()) !== Boolean(value.action), {
  message: "Provide either a change description or a quick action.",
});

type RouteContext = { params: Promise<{ eventId: string }> };

function manualPlanB(failures: string[], optionsUnavailable = false) {
  if (optionsUnavailable) {
    return {
      title: "Plan B: manual adjustment required",
      summary: "Automated options could not be generated. Your plan has not been changed.",
      steps: ["Keep the current schedule in place. Confirm a safe adjustment with the event organizer, then retry when automated options are available."],
      blockers: failures.slice(0, 3),
    };
  }

  const steps = failures
    .map((failure) => {
      const separator = failure.indexOf(": ");
      return separator < 0 ? failure : failure.slice(separator + 2);
    })
    .map((reason) => {
      const dependency = reason.match(/^(.+) starts before (.+) finishes\.$/);
      if (dependency) {
        return `Schedule ${dependency[1]} after ${dependency[2]} finishes. Confirm the finish time, then choose the next available slot.`;
      }
      const cancelledDependency = reason.match(/^(.+) depends on cancelled task (.+)\.$/);
      if (cancelledDependency) {
        return `Confirm whether ${cancelledDependency[2]} can be restored. If not, revise ${cancelledDependency[1]} so it no longer depends on that task.`;
      }
      const venueClose = reason.match(/^(.+) ends after the venue closes\.$/);
      if (venueClose) {
        return `Move or shorten ${venueClose[1]} so it finishes before the venue closes, or confirm an extension with the venue.`;
      }
      const eventEnd = reason.match(/^(.+) ends after the event end time\.$/);
      if (eventEnd) {
        return `Move or shorten ${eventEnd[1]} so it finishes before the planned event end.`;
      }
      if (/budget/i.test(reason)) {
        return "Rework the affected costs or confirm a budget increase before approving this change.";
      }
      return `Resolve this schedule check before applying the change: ${reason}`;
    })
    .filter((step, index, all) => all.indexOf(step) === index)
    .slice(0, 3);

  return {
    title: "Plan B: manual adjustment required",
    summary: "No automated option passed the safety checks. Your plan has not been changed.",
    steps: steps.length > 0
      ? steps
      : ["Review the affected tasks and constraints, make a feasible update, then submit it again."],
    blockers: failures.slice(0, 3),
  };
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  const parsedBody = await parseJsonBody(request, RequestSchema, 8 * 1024);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
  }

  const body = parsedBody.data;
  try {
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:intake`, 12)) {
      return NextResponse.json({ error: "Too many change requests. Please wait a minute and try again." }, { status: 429 });
    }
    const run = await loadOwnedOrganizerRun(request, eventId);
    if (run.version !== body.version) {
      const taskAlreadyDone = body.action === "task-done"
        && body.taskId
        && run.plan.timeline.some((task) => task.id === body.taskId && task.status === "done");
      if (taskAlreadyDone) {
        return NextResponse.json({ completedTask: true, version: run.version, plan: run.plan });
      }
      return NextResponse.json({ error: "The plan changed. Refresh to see the latest version.", stale: true }, { status: 409 });
    }

    let changes: RunChange[] = [];
    let clarifyingQuestion: string | null = null;
    if (body.action) {
      const change = parseQuickChange(body.action, run.plan);
      if (!change) return NextResponse.json({ error: "That quick action is not available." }, { status: 400 });
      if (body.taskId && ["delay-15", "delay-30", "task-done", "vendor-cancelled"].includes(body.action)) change.taskId = body.taskId;
      if (body.action === "vendor-cancelled" && !change.taskId) {
        return NextResponse.json({ error: "Choose the task whose vendor cancelled." }, { status: 400 });
      }
      if (body.action === "task-done" && !change.taskId) {
        return NextResponse.json({ error: "Choose the task you completed." }, { status: 400 });
      }
      changes = [change];
    } else {
      const parsed = await parseChangeText(body.text ?? "", run.plan);
      changes = parsed.changes;
      clarifyingQuestion = parsed.clarifyingQuestion;
    }

    if (clarifyingQuestion) {
      await sql`INSERT INTO plan_events (event_id, type, payload, actor)
        VALUES (${run.eventId}, 'CLARIFICATION', ${JSON.stringify({ question: clarifyingQuestion, input: body.text })}, 'organizer')`;
      return NextResponse.json({ clarifyingQuestion });
    }

    if (changes.length === 1 && changes[0].type === "TASK_DONE" && changes[0].taskId) {
      const task = run.plan.timeline.find((entry) => entry.id === changes[0].taskId);
      if (!task) return NextResponse.json({ error: "That task is not in this plan." }, { status: 400 });
      if (task.status === "done") {
        return NextResponse.json({ completedTask: true, version: run.version, plan: run.plan });
      }
      const change = { ...changes[0], actualAt: new Date().toISOString() };
      const result = await commitPlanVersion({
        eventId: run.eventId,
        expectedVersion: run.version,
        idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
        plan: applyChanges(run.plan, [change]),
        changes: [change],
        note: `Task completed: ${task.task}`,
        actor: "organizer",
      });
      return NextResponse.json({ completedTask: true, version: result.version, plan: result.plan });
    }

    const impact = analyzeImpact(run.plan, changes);
    const risksRows = await sql`SELECT id, title, trigger_type, likelihood, backup_action, status
      FROM risks WHERE event_id = ${run.eventId} AND status IN ('ready', 'triggered')`;
    const risks: PlanRisk[] = risksRows.map((risk) => ({
      id: String(risk.id),
      title: String(risk.title),
      triggerType: String(risk.trigger_type) as PlanRisk["triggerType"],
      likelihood: String(risk.likelihood) as PlanRisk["likelihood"],
      backupAction: risk.backup_action as PlanRisk["backupAction"],
      status: risk.status as PlanRisk["status"],
    }));
    const priorities = Array.isArray(run.answers.priorities) ? run.answers.priorities.map(String) : [];
    const constraints = [
      run.plan.constraints?.venueClosesAt ? `Venue closes at ${run.plan.constraints.venueClosesAt}` : "",
      run.plan.constraints?.eventEndsAt ? `Event ends at ${run.plan.constraints.eventEndsAt}` : "",
    ].filter(Boolean);

    let options: RunOption[];
    try {
      options = await generateOptions({ plan: run.plan, changes, impact, risks, priorities, constraints });
    } catch (error) {
      if (!(error instanceof z.ZodError)) {
        console.error("[/api/run intake] Automated options could not be generated.", error);
        return NextResponse.json({
          manualPlanB: manualPlanB(["Automated options could not be generated."], true),
        });
      }
      console.warn("[/api/run intake] Option output failed validation; trying a deterministic schedule-only fallback.", error.issues);
      const fallback = deterministicShiftOption(run.plan, changes, impact);
      if (!fallback) {
        return NextResponse.json({
          manualPlanB: manualPlanB(["No safe deterministic adjustment was available."], true),
        });
      }
      options = [fallback];
    }
    let verification = verifyOptions(run.plan, changes, impact, options);
    if (verification.verified.length === 0) {
      try {
        options = await generateOptions({
          plan: run.plan, changes, impact, risks, priorities, constraints,
          retryReasons: verification.failures, usePrepared: false,
        });
      } catch (error) {
        console.error("[/api/run intake] Safe option retry failed.", error);
        return NextResponse.json({
          manualPlanB: manualPlanB(
            [...verification.failures, "Automated option retry failed."],
            true,
          ),
        });
      }
      verification = verifyOptions(run.plan, changes, impact, options);
    }
    if (verification.verified.length === 0) {
      const fallback = deterministicShiftOption(run.plan, changes, impact);
      if (fallback) verification = verifyOptions(run.plan, changes, impact, [fallback]);
    }
    if (verification.verified.length === 0) {
      return NextResponse.json({
        manualPlanB: manualPlanB(verification.failures),
      });
    }

    const payload = {
      changes,
      impact,
      options: verification.verified.map(({ title, operations, tradeoffs, rupeeImpact, source }) => ({
        title, operations, tradeoffs, rupeeImpact, source,
      })),
      verified: verification.verified,
    };
    const proposals = await sql`INSERT INTO run_proposals (event_id, source_version, payload)
      VALUES (${run.eventId}, ${run.version}, ${JSON.stringify(payload)}::jsonb) RETURNING id`;
    return NextResponse.json({
      proposalId: proposals[0].id,
      version: run.version,
      changes,
      impact,
      options: verification.verified.map(({ plan: optionPlan, report, ...option }) => ({
        ...option,
        report,
        plan: optionPlan,
      })),
    });
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) {
      console.error("[/api/run intake] Pipeline data failed schema validation.", error.issues);
      return NextResponse.json({
        error: "I couldn't safely validate an adjustment for that update. Your input is still here—please retry.",
      }, { status: 503 });
    }
    console.error("[/api/run intake]", error);
    return NextResponse.json({ error: "I couldn't safely prepare that change. Your input is still here—please retry." }, { status: 503 });
  }
}

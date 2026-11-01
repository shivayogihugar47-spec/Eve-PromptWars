import { sql } from "@/lib/db";
import { analyzeImpact } from "./impact";
import { verifyOptions } from "./verify";
import type { RunChange, RunOption, RunPlan, VerifiedOption } from "./types";
import { loadOwnedOrganizerRun } from "./security";

export class RunApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RunApiError";
  }
}

function isValidIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function taskRows(plan: RunPlan) {
  return plan.timeline.map((task) => ({
    id: task.id,
    title: task.task,
    start_time: task.startAt,
    end_time: new Date(Date.parse(task.startAt) + task.durationMin * 60_000).toISOString(),
    duration_min: task.durationMin,
    owner_name: task.owner,
    depends_on: task.dependsOn,
    status: task.status,
    vendor_name: task.vendorName ?? null,
    actual_end_time: task.actualAt ?? null,
  }));
}

export async function commitPlanVersion(input: {
  eventId: string;
  expectedVersion: number;
  idempotencyKey: string;
  plan: RunPlan;
  changes: RunChange[];
  note: string;
  actor: string;
}): Promise<{ version: number; plan: RunPlan; idempotent: boolean }> {
  if (!isValidIdempotencyKey(input.idempotencyKey)) {
    throw new RunApiError("A valid idempotency key is required.", 400);
  }
  const replay = await sql`SELECT event_id, version, result FROM run_apply_requests WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`;
  if (replay[0]) {
    if (replay[0].event_id !== input.eventId) throw new RunApiError("This request key belongs to another event.", 409);
    return {
      version: Number(replay[0].version),
      plan: replay[0].result as RunPlan,
      idempotent: true,
    };
  }

  const nextVersion = input.expectedVersion + 1;
  const operationNonce = crypto.randomUUID();
  const answersPatch: Record<string, unknown> = {};
  answersPatch.guestCount = String(input.plan.guestCount);
  answersPatch.budgetTotal = `₹${input.plan.budgetTotal}`;
  answersPatch.eventDate = input.plan.eventDate;
  for (const change of input.changes) {
    if (change.guestCount !== undefined) answersPatch.guestCount = String(change.guestCount);
    if (change.budgetTotal !== undefined) answersPatch.budgetTotal = `₹${change.budgetTotal}`;
    if (change.eventDate) answersPatch.eventDate = change.eventDate;
  }
  const rows = await sql.transaction([
    sql`WITH advanced AS (
      UPDATE events SET current_plan_version = ${nextVersion}, budget_total = ${input.plan.budgetTotal},
        event_date = ${input.plan.eventDate}::date,
        event_end_at = ${input.plan.constraints?.eventEndsAt ?? null},
        venue_closes_at = ${input.plan.constraints?.venueClosesAt ?? null},
        outdoor = ${Boolean(input.plan.constraints?.outdoor)},
        answers = answers || ${JSON.stringify(answersPatch)}::jsonb
      WHERE id = ${input.eventId} AND current_plan_version = ${input.expectedVersion}
        AND NOT EXISTS (SELECT 1 FROM run_apply_requests WHERE idempotency_key = ${input.idempotencyKey})
      RETURNING id
    ), recorded AS (
      INSERT INTO run_apply_requests (idempotency_key, event_id, version, operation_nonce, result)
      SELECT ${input.idempotencyKey}, advanced.id, ${nextVersion}, ${operationNonce}, ${JSON.stringify(input.plan)}::jsonb
      FROM advanced RETURNING idempotency_key, version, operation_nonce
    ), snapshot AS (
      INSERT INTO plan_versions (event_id, version, plan, change_note)
      SELECT ${input.eventId}, recorded.version, ${JSON.stringify(input.plan)}::jsonb, ${input.note}
      FROM recorded RETURNING version
    )
    SELECT recorded.version, recorded.operation_nonce FROM recorded JOIN snapshot USING (version)`,
    sql`INSERT INTO tasks (id, event_id, title, start_time, end_time, duration_min, owner_name, depends_on, status, vendor_name, actual_end_time)
      SELECT task.id, ${input.eventId}, task.title, task.start_time, task.end_time, task.duration_min,
        task.owner_name, ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(task.depends_on)),
        task.status, task.vendor_name, task.actual_end_time
      FROM jsonb_to_recordset(${JSON.stringify(taskRows(input.plan))}::jsonb) AS task(
        id uuid, title text, start_time timestamptz, end_time timestamptz, duration_min integer,
        owner_name text, depends_on jsonb, status text, vendor_name text, actual_end_time timestamptz
      )
      WHERE EXISTS (SELECT 1 FROM run_apply_requests WHERE operation_nonce = ${operationNonce})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time, duration_min = EXCLUDED.duration_min, owner_name = EXCLUDED.owner_name,
        depends_on = EXCLUDED.depends_on, status = EXCLUDED.status, vendor_name = EXCLUDED.vendor_name,
        actual_end_time = EXCLUDED.actual_end_time`,
    sql`INSERT INTO plan_events (event_id, type, payload, actor)
      SELECT ${input.eventId}, 'APPLIED',
        ${JSON.stringify({ version: nextVersion, changes: input.changes, note: input.note })}::jsonb, ${input.actor}
      WHERE EXISTS (SELECT 1 FROM run_apply_requests WHERE operation_nonce = ${operationNonce})`,
    sql`UPDATE risks SET status = 'triggered'
      WHERE event_id = ${input.eventId} AND status = 'ready'
        AND trigger_type IN (SELECT change.type FROM jsonb_to_recordset(${JSON.stringify(input.changes)}::jsonb) AS change(type text))
        AND EXISTS (SELECT 1 FROM run_apply_requests WHERE operation_nonce = ${operationNonce})`,
  ]);
  const committed = rows[0]?.[0] as { version: number; operation_nonce: string } | undefined;
  if (!committed) {
    const duplicate = await sql`SELECT event_id, version, result FROM run_apply_requests WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`;
    if (duplicate[0]?.event_id === input.eventId) {
      return { version: Number(duplicate[0].version), plan: duplicate[0].result as RunPlan, idempotent: true };
    }
    throw new RunApiError("This plan changed while you were reviewing. Refresh and try again.", 409);
  }
  return { version: Number(committed.version), plan: input.plan, idempotent: false };
}

export async function applyProposal(input: {
  request: Request;
  eventId: string;
  proposalId: string;
  optionIndex: number;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ version: number; plan: RunPlan; option: VerifiedOption; changes: RunChange[]; idempotent: boolean }> {
  const run = await loadOwnedOrganizerRun(input.request, input.eventId);
  return applySelectedProposal({ ...input, run, actor: "organizer" });
}

export async function applySelectedProposal(input: {
  run: { eventId: string; version: number; plan: RunPlan };
  eventId: string;
  proposalId: string;
  optionIndex: number;
  expectedVersion: number;
  idempotencyKey: string;
  actor: string;
}): Promise<{ version: number; plan: RunPlan; option: VerifiedOption; changes: RunChange[]; idempotent: boolean }> {
  const run = input.run;
  const replay = await sql`SELECT event_id, version, result FROM run_apply_requests WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`;
  if (replay[0]) {
    if (replay[0].event_id !== input.eventId) throw new RunApiError("This request key belongs to another event.", 409);
    const proposalRows = await sql`SELECT payload FROM run_proposals WHERE id = ${input.proposalId} AND event_id = ${input.eventId} LIMIT 1`;
    const payload = proposalRows[0]?.payload as { changes?: RunChange[]; verified?: VerifiedOption[] } | undefined;
    const previousOption = payload?.verified?.[input.optionIndex];
    if (!previousOption) throw new RunApiError("This idempotency key was already used for a different action.", 409);
    return {
      version: Number(replay[0].version),
      plan: replay[0].result as RunPlan,
      option: previousOption,
      idempotent: true,
      changes: payload?.changes ?? [],
    };
  }
  if (run.version !== input.expectedVersion) {
    throw new RunApiError("This plan changed while you were reviewing. Refresh and try again.", 409);
  }
  const proposalRows = await sql`SELECT source_version, payload FROM run_proposals
    WHERE id = ${input.proposalId} AND event_id = ${input.eventId} AND expires_at > now() LIMIT 1`;
  const proposal = proposalRows[0]?.payload as {
    changes: RunChange[];
    impact: ReturnType<typeof analyzeImpact>;
    options: RunOption[];
  } | undefined;
  if (!proposal || Number(proposalRows[0].source_version) !== run.version) {
    throw new RunApiError("That change preview expired. Submit the update again.", 409);
  }
  const verified = verifyOptions(run.plan, proposal.changes, proposal.impact, proposal.options);
  const option = verified.verified[input.optionIndex];
  if (!option) throw new RunApiError("That option is no longer valid. Refresh and review the verified options.", 409);

  const committed = await commitPlanVersion({
    eventId: run.eventId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    plan: option.plan,
    changes: proposal.changes,
    note: `RUN change applied: ${option.title}`,
    actor: input.actor,
  });
  return { ...committed, option, changes: proposal.changes };
}

export async function revertToPreviousVersion(input: {
  request: Request;
  eventId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ version: number; plan: RunPlan; idempotent: boolean }> {
  const run = await loadOwnedOrganizerRun(input.request, input.eventId);
  const replay = await sql`SELECT event_id, version, result FROM run_apply_requests WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`;
  if (replay[0]) {
    if (replay[0].event_id !== input.eventId) throw new RunApiError("This request key belongs to another event.", 409);
    return { version: Number(replay[0].version), plan: replay[0].result as RunPlan, idempotent: true };
  }
  if (run.version !== input.expectedVersion) {
    throw new RunApiError("This plan changed before it could be reverted. Refresh and try again.", 409);
  }
  if (run.version <= 1) throw new RunApiError("There is no previous version to restore.", 400);
  const previous = await sql`SELECT plan FROM plan_versions WHERE event_id = ${input.eventId} AND version = ${run.version - 1} LIMIT 1`;
  if (!previous[0]?.plan) throw new RunApiError("The previous plan version is unavailable.", 404);
  const previousPlan = previous[0].plan as RunPlan;
  const committed = await commitPlanVersion({
    eventId: input.eventId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    plan: previousPlan,
    changes: [],
    note: `Reverted to version ${run.version - 1}`,
    actor: "organizer",
  });
  return committed;
}

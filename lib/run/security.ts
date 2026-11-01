import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import type { RunPlan } from "./types";

export interface OrganizerRun {
  eventId: string;
  version: number;
  plan: RunPlan;
  answers: Record<string, unknown>;
  organizerToken: string;
}

export interface OwnerRun {
  eventId: string;
  version: number;
  plan: RunPlan;
  taskIds: string[];
}

export function createBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function publicRateLimitIdentity(request: Request): string {
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return hashToken(`ip:${forwardedIp || "anonymous"}`);
}

export function rateLimitIdentity(request: Request): string {
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1] ?? "missing";
  return hashToken(bearer);
}

export async function saveLockedRun(
  plan: RunPlan,
  answers: Record<string, unknown>,
  risks: { title: string; triggerType: string; likelihood: string; backupAction: unknown[] }[],
  ownerUserId: string | null,
): Promise<{ eventId: string; organizerToken: string; version: number; ownerLinks: { owner: string; token: string; taskIds: string[]; expiresAt: string }[] }> {
  const eventId = crypto.randomUUID();
  const organizerToken = createBearerToken();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString();
  const ownerGroups = new Map<string, string[]>();
  for (const task of plan.timeline) {
    const owner = task.owner.trim();
    if (!owner || /^unassigned$/i.test(owner)) continue;
    ownerGroups.set(owner, [...(ownerGroups.get(owner) ?? []), task.id]);
  }
  const ownerLinks = Array.from(ownerGroups, ([owner, taskIds]) => ({
    owner,
    token: createBearerToken(),
    taskIds,
    expiresAt,
  }));
  const taskRows = plan.timeline.map((task) => ({
    id: task.id,
    title: task.task,
    start_time: task.startAt,
    end_time: new Date(Date.parse(task.startAt) + task.durationMin * 60_000).toISOString(),
    duration_min: task.durationMin,
    owner_name: task.owner,
    depends_on: task.dependsOn,
    budget_item: null,
    status: task.status,
    vendor_name: task.vendorName ?? null,
    actual_end_time: task.actualAt ?? null,
  }));

  await sql.transaction([
    sql`INSERT INTO events
      (id, stage, answers, event_type, event_date, budget_total, current_plan_version, organizer_token_hash, organizer_token_expires_at, owner_user_id, event_end_at, venue_closes_at, outdoor)
      VALUES (${eventId}, 'run', ${JSON.stringify(answers)}, ${plan.eventType}, ${plan.eventDate},
        ${plan.budgetTotal}, 1, ${hashToken(organizerToken)}, ${expiresAt}, ${ownerUserId}, ${plan.constraints?.eventEndsAt ?? null},
        ${plan.constraints?.venueClosesAt ?? null}, ${Boolean(plan.constraints?.outdoor)})`,
    sql`INSERT INTO plan_versions (event_id, version, plan, change_note)
      VALUES (${eventId}, 1, ${JSON.stringify(plan)}, 'Plan locked')`,
    sql`INSERT INTO tasks (id, event_id, title, start_time, end_time, duration_min, owner_name, depends_on, budget_item, status, vendor_name, actual_end_time)
      SELECT task.id, ${eventId}, task.title, task.start_time, task.end_time, task.duration_min,
        task.owner_name, ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(task.depends_on)),
        task.budget_item, task.status, task.vendor_name, task.actual_end_time
      FROM jsonb_to_recordset(${JSON.stringify(taskRows)}::jsonb) AS task(
        id uuid, title text, start_time timestamptz, end_time timestamptz, duration_min integer,
        owner_name text, depends_on jsonb, budget_item text, status text, vendor_name text, actual_end_time timestamptz
      )`,
    sql`INSERT INTO risks (event_id, title, trigger_type, likelihood, backup_action)
      SELECT ${eventId}, risk.title, risk.trigger_type, risk.likelihood, risk.backup_action
      FROM jsonb_to_recordset(${JSON.stringify(risks.map((risk) => ({
        title: risk.title,
        trigger_type: risk.triggerType,
        likelihood: risk.likelihood,
        backup_action: risk.backupAction,
      })))}::jsonb) AS risk(title text, trigger_type text, likelihood text, backup_action jsonb)`,
    sql`INSERT INTO owner_links (token, event_id, task_ids, expires_at)
      SELECT link.token, ${eventId}, ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(link.task_ids)), link.expires_at
      FROM jsonb_to_recordset(${JSON.stringify(ownerLinks.map(({ token, taskIds, expiresAt }) => ({
        token,
        task_ids: taskIds,
        expires_at: expiresAt,
      })))}::jsonb) AS link(token text, task_ids jsonb, expires_at timestamptz)`,
    sql`INSERT INTO plan_events (event_id, type, payload, actor)
      VALUES (${eventId}, 'LOCKED', ${JSON.stringify({ version: 1, eventType: plan.eventType })}, 'organizer')`,
  ]);

  return { eventId, organizerToken, version: 1, ownerLinks };
}

export async function loadOrganizerRun(request: Request, eventId: string): Promise<OrganizerRun> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(eventId)) throw new Error("Event not found.");
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
  if (!bearer) throw new Error("Organizer authorization is required.");
  const stored = await sql`SELECT organizer_token_hash, organizer_token_expires_at, current_plan_version, answers
    FROM events WHERE id = ${eventId} LIMIT 1`;
  if (!stored[0]?.organizer_token_hash) throw new Error("Event not found.");
  if (!stored[0].organizer_token_expires_at || Date.parse(String(stored[0].organizer_token_expires_at)) <= Date.now()) {
    throw new Error("Organizer authorization is invalid or expired.");
  }
  const expected = Buffer.from(String(stored[0].organizer_token_hash), "hex");
  const actual = Buffer.from(hashToken(bearer), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Organizer authorization is invalid.");
  }
  const version = Number(stored[0].current_plan_version);
  const rows = await sql`SELECT plan FROM plan_versions WHERE event_id = ${eventId} AND version = ${version} LIMIT 1`;
  if (!rows[0]?.plan) throw new Error("The current event plan is unavailable.");
  return {
    eventId,
    version,
    plan: rows[0].plan as RunPlan,
    answers: stored[0].answers as Record<string, unknown>,
    organizerToken: bearer,
  };
}

export async function loadOwnedOrganizerRun(request: Request, eventId: string): Promise<OrganizerRun> {
  try {
    return await loadOrganizerRun(request, eventId);
  } catch (bearerError) {
    const { getAuthenticatedUser } = await import("@/lib/auth/server");
    const user = await getAuthenticatedUser();
    if (!user) throw bearerError;

    const events = await sql`SELECT owner_user_id, current_plan_version, answers
      FROM events WHERE id = ${eventId} LIMIT 1`;
    if (!events[0] || events[0].owner_user_id !== user.id) throw bearerError;

    const version = Number(events[0].current_plan_version);
    const rows = await sql`SELECT plan FROM plan_versions
      WHERE event_id = ${eventId} AND version = ${version} LIMIT 1`;
    if (!rows[0]?.plan) throw new Error("The current event plan is unavailable.");
    return {
      eventId,
      version,
      plan: rows[0].plan as RunPlan,
      answers: events[0].answers as Record<string, unknown>,
      organizerToken: "",
    };
  }
}

export async function loadOwnerRun(token: string): Promise<OwnerRun> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Owner link is invalid or expired.");
  const links = await sql`SELECT event_id, task_ids FROM owner_links
    WHERE token = ${token} AND expires_at > now() LIMIT 1`;
  if (!links[0]) throw new Error("Owner link is invalid or expired.");
  const eventId = String(links[0].event_id);
  const taskIds = links[0].task_ids as string[];
  const events = await sql`SELECT current_plan_version FROM events WHERE id = ${eventId} LIMIT 1`;
  if (!events[0]) throw new Error("Owner link is invalid or expired.");
  const version = Number(events[0].current_plan_version);
  const plans = await sql`SELECT plan FROM plan_versions WHERE event_id = ${eventId} AND version = ${version} LIMIT 1`;
  if (!plans[0]?.plan) throw new Error("The current event plan is unavailable.");
  return { eventId, version, plan: plans[0].plan as RunPlan, taskIds };
}

export async function consumeRateLimit(bucket: string, limit: number): Promise<boolean> {
  const windowStartedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const rows = await sql`INSERT INTO run_rate_limits (bucket, window_started_at, hits)
    VALUES (${bucket}, ${windowStartedAt}, 1)
    ON CONFLICT (bucket, window_started_at)
    DO UPDATE SET hits = run_rate_limits.hits + 1
    RETURNING hits`;
  await sql`DELETE FROM run_rate_limits WHERE window_started_at < now() - interval '10 minutes'`;
  return Number(rows[0]?.hits ?? limit + 1) <= limit;
}

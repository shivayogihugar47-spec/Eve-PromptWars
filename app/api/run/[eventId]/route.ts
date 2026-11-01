import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { loadOwnedOrganizerRun, consumeRateLimit, rateLimitIdentity } from "@/lib/run/security";
import { isUuid } from "@/lib/apiRequest";
import { isSyntheticFallbackRisk } from "@/lib/run/types";

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  try {
    const run = await loadOwnedOrganizerRun(request, eventId);
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:poll`, 40)) {
      return NextResponse.json({ error: "Too many refreshes. Try again shortly." }, { status: 429 });
    }
    const [eventRows, riskRows, auditRows, ownerRows] = await Promise.all([
      sql`SELECT event_type, event_date, current_plan_version FROM events WHERE id = ${eventId} LIMIT 1`,
      sql`SELECT id, title, trigger_type, likelihood, backup_action, status FROM risks
        WHERE event_id = ${eventId} ORDER BY created_at`,
      sql`SELECT id, type, payload, actor, created_at FROM plan_events
        WHERE event_id = ${eventId} ORDER BY created_at DESC LIMIT 100`,
      sql`SELECT token, task_ids, expires_at FROM owner_links
        WHERE event_id = ${eventId} AND expires_at > now()`,
    ]);
    return NextResponse.json({
      eventId: run.eventId,
      version: run.version,
      plan: run.plan,
      event: eventRows[0],
      risks: riskRows.map((risk) => ({
        id: risk.id,
        title: risk.title,
        triggerType: risk.trigger_type,
        likelihood: risk.likelihood,
        backupAction: risk.backup_action,
        status: risk.status,
      })).filter((risk) => !isSyntheticFallbackRisk(risk)),
      audit: auditRows,
      ownerLinks: ownerRows,
    });
  } catch (error) {
    console.error("[/api/run GET]", error);
    return NextResponse.json({ error: "Unable to load the live event. Refresh and try again." }, { status: 401 });
  }
}

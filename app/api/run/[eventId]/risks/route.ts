import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/apiRequest";
import { generateRisks } from "@/lib/run/risks";
import { consumeRateLimit, loadOwnedOrganizerRun, rateLimitIdentity } from "@/lib/run/security";
import { isSyntheticFallbackRisk } from "@/lib/run/types";

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  try {
    const run = await loadOwnedOrganizerRun(request, eventId);
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:risks`, 3)) {
      return NextResponse.json({ error: "Plan B was just generated. Try again shortly." }, { status: 429 });
    }

    const risks = await generateRisks(run.plan);
    const savedRisks = await sql`
      INSERT INTO risks (event_id, title, trigger_type, likelihood, backup_action)
      SELECT ${eventId}, risk.title, risk.trigger_type, risk.likelihood, risk.backup_action
      FROM jsonb_to_recordset(${JSON.stringify(risks.map((risk) => ({
        title: risk.title,
        trigger_type: risk.triggerType,
        likelihood: risk.likelihood,
        backup_action: risk.backupAction,
      })))}::jsonb) AS risk(title text, trigger_type text, likelihood text, backup_action jsonb)
      RETURNING id, title, trigger_type, likelihood, backup_action, status
    `;

    const previousRisks = await sql`SELECT id, title FROM risks WHERE event_id = ${eventId} AND status = 'ready'`;
    const syntheticIds = previousRisks
      .filter((risk) => isSyntheticFallbackRisk({ title: String(risk.title) }))
      .map((risk) => String(risk.id));
    if (syntheticIds.length > 0) {
      await sql`UPDATE risks SET status = 'dismissed' WHERE id = ANY(${syntheticIds}::uuid[])`;
    }

    return NextResponse.json({
      risks: savedRisks.map((risk) => ({
        id: risk.id,
        title: risk.title,
        triggerType: risk.trigger_type,
        likelihood: risk.likelihood,
        backupAction: risk.backup_action,
        status: risk.status,
      })),
    });
  } catch (error) {
    console.error("[/api/run risks]", error);
    return NextResponse.json({ error: "Unable to generate event-specific Plan B options. Please retry." }, { status: 503 });
  }
}

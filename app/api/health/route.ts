import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

function isMissingDatabaseSchema(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "42703" || error.code === "42P01");
}

export async function GET() {
  const openrouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);
  let databaseStatus: "ok" | "unavailable" | "schema_outdated" = "unavailable";

  try {
    await sql`SELECT 1 AS result`;
    try {
      await sql`
        SELECT e.organizer_token_expires_at, e.owner_user_id, e.event_end_at,
          e.venue_closes_at, e.outdoor, t.end_time, t.actual_start_time,
          t.actual_end_time, t.vendor_name, ol.expires_at
        FROM events e
        LEFT JOIN tasks t ON FALSE
        LEFT JOIN owner_links ol ON FALSE
        LIMIT 0
      `;
      databaseStatus = "ok";
    } catch (error) {
      databaseStatus = isMissingDatabaseSchema(error) ? "schema_outdated" : "unavailable";
    }
  } catch {
    databaseStatus = "unavailable";
  }

  const report = {
    status: databaseStatus === "ok" && openrouterConfigured ? "ok" : "degraded",
    database: databaseStatus,
    openrouter: openrouterConfigured ? "configured" : "missing",
  } as const;

  return NextResponse.json(report, {
    status: databaseStatus === "ok" && openrouterConfigured ? 200 : 503,
  });
}

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth/server";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Sign in to view your saved events." }, { status: 401 });

    const rows = await sql`
      SELECT e.id, e.event_type, e.event_date, e.budget_total, e.current_plan_version,
        e.created_at, latest.plan->>'city' AS city
      FROM events e
      JOIN plan_versions latest
        ON latest.event_id = e.id AND latest.version = e.current_plan_version
      WHERE e.owner_user_id = ${user.id}
      ORDER BY e.created_at DESC
      LIMIT 100`;

    return NextResponse.json({
      events: rows.map((row) => ({
        id: String(row.id),
        eventType: String(row.event_type ?? "Event"),
        eventDate: String(row.event_date ?? ""),
        city: String(row.city ?? ""),
        budgetTotal: Number(row.budget_total ?? 0),
        version: Number(row.current_plan_version),
        createdAt: String(row.created_at),
      })),
    });
  } catch (error) {
    console.error("[/api/events GET]", error);
    return NextResponse.json({ error: "Unable to load your saved events. Please retry." }, { status: 503 });
  }
}

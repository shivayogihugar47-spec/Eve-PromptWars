import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { applyProposal, RunApiError } from "@/lib/run/apply";
import { draftOwnerNotifications } from "@/lib/run/notify";
import { consumeRateLimit, rateLimitIdentity } from "@/lib/run/security";
import { parseJsonBody } from "@/lib/apiRequest";
import { isUuid } from "@/lib/apiRequest";

const ApplySchema = z.object({
  proposalId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(2),
  version: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
});

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  try {
    const parsedBody = await parseJsonBody(request, ApplySchema, 4 * 1024);
    if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    const body = parsedBody.data;
    if (!await consumeRateLimit(`${eventId}:${rateLimitIdentity(request)}:apply`, 10)) {
      return NextResponse.json({ error: "Too many apply attempts. Try again shortly." }, { status: 429 });
    }
    const result = await applyProposal({
      request,
      eventId,
      proposalId: body.proposalId,
      optionIndex: body.optionIndex,
      expectedVersion: body.version,
      idempotencyKey: body.idempotencyKey,
    });

    let notifications: Awaited<ReturnType<typeof draftOwnerNotifications>> = [];
    let notificationError: string | null = null;
    if (!result.idempotent) {
      try {
        notifications = await draftOwnerNotifications(
          eventId,
          result.plan,
          result.changes,
          result.option.report.affectedTasks.map((task) => task.id),
        );
        await sql`INSERT INTO plan_events (event_id, type, payload, actor)
          VALUES (${eventId}, 'NOTIFY', ${JSON.stringify({
            version: result.version,
            taskIds: notifications.map((message) => message.taskId),
          })}::jsonb, 'system')`;
      } catch (error) {
        console.error("[/api/run apply notify]", error);
        notificationError = "The change was applied, but message drafts could not be prepared. Use Retry notifications.";
        await sql`INSERT INTO plan_events (event_id, type, payload, actor)
          VALUES (${eventId}, 'NOTIFY_FAILED', ${JSON.stringify({ version: result.version })}::jsonb, 'system')`;
      }
    }

    return NextResponse.json({
      version: result.version,
      plan: result.plan,
      idempotent: result.idempotent,
      notifications,
      notificationError,
    });
  } catch (error) {
    if (error instanceof RunApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Choose one of the verified options and retry." }, { status: 400 });
    console.error("[/api/run apply]", error);
    return NextResponse.json({ error: "Unable to apply this change. Your reviewed input is still available; please retry." }, { status: 503 });
  }
}

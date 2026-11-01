import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  commitPlanVersion: vi.fn(),
  consumeRateLimit: vi.fn(),
  loadOwnedOrganizerRun: vi.fn(),
  rateLimitIdentity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/run/apply", () => ({
  commitPlanVersion: mocks.commitPlanVersion,
  RunApiError: class RunApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock("@/lib/run/security", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  loadOwnedOrganizerRun: mocks.loadOwnedOrganizerRun,
  rateLimitIdentity: mocks.rateLimitIdentity,
}));

import { POST } from "@/app/api/run/[eventId]/intake/route";
import type { RunPlan, RunTask } from "@/lib/run/types";

const eventId = "00000000-0000-4000-8000-000000000099";
const taskId = "00000000-0000-4000-8000-000000000001";

function makePlan(): RunPlan {
  const task: RunTask = {
    id: taskId,
    task: "Catering setup",
    time: "09:30",
    startAt: "2026-11-01T09:30:00.000Z",
    durationMin: 30,
    dependsOn: [],
    owner: "Catering team",
    status: "pending",
    icon: "utensils",
  };
  return {
    eventType: "wedding",
    eventDate: "2026-11-01",
    guestCount: 100,
    city: "Pune",
    budgetTotal: 100000,
    accessibilityNeeds: "Wheelchair access",
    ageMix: "A mix of ages",
    timeline: [task],
    budgetBreakdown: [],
    vendors: [],
    checklist: [],
  };
}

describe("organizer task completion", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.commitPlanVersion.mockReset();
    mocks.consumeRateLimit.mockReset();
    mocks.loadOwnedOrganizerRun.mockReset();
    mocks.rateLimitIdentity.mockReset();
    mocks.consumeRateLimit.mockResolvedValue(true);
    mocks.rateLimitIdentity.mockReturnValue("organizer");
    mocks.sql.mockResolvedValue([]);
    mocks.loadOwnedOrganizerRun.mockResolvedValue({
      eventId,
      version: 1,
      plan: makePlan(),
      answers: {},
      organizerToken: "organizer-token",
    });
  });

  it("records completion as a new version without asking for an AI option", async () => {
    mocks.commitPlanVersion.mockImplementation(async (input: {
      plan: RunPlan;
      expectedVersion: number;
      idempotencyKey: string;
      changes: { type: string; taskId?: string }[];
    }) => ({
      version: input.expectedVersion + 1,
      plan: input.plan,
      idempotent: false,
    }));

    const response = await POST(
      new Request(`https://eventmate.test/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          action: "task-done",
          taskId,
          idempotencyKey: "mark-task-done-1",
        }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ completedTask: true, version: 2 });
    expect(mocks.commitPlanVersion).toHaveBeenCalledWith(expect.objectContaining({
      eventId,
      expectedVersion: 1,
      idempotencyKey: "mark-task-done-1",
      actor: "organizer",
      note: "Task completed: Catering setup",
      changes: [expect.objectContaining({ type: "TASK_DONE", taskId })],
    }));
    expect(mocks.commitPlanVersion.mock.calls[0][0].plan.timeline[0].status).toBe("done");
  });

  it("rejects completion updates against a stale plan version", async () => {
    mocks.loadOwnedOrganizerRun.mockResolvedValue({
      eventId,
      version: 2,
      plan: makePlan(),
      answers: {},
      organizerToken: "organizer-token",
    });

    const response = await POST(
      new Request(`https://eventmate.test/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, action: "task-done", taskId }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.commitPlanVersion).not.toHaveBeenCalled();
  });

  it("treats a retried completion as successful when the task is already done", async () => {
    const plan = makePlan();
    plan.timeline[0].status = "done";
    mocks.loadOwnedOrganizerRun.mockResolvedValue({
      eventId,
      version: 2,
      plan,
      answers: {},
      organizerToken: "organizer-token",
    });

    const response = await POST(
      new Request(`https://eventmate.test/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          action: "task-done",
          taskId,
          idempotencyKey: "mark-task-done-1",
        }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ completedTask: true, version: 2 });
    expect(mocks.commitPlanVersion).not.toHaveBeenCalled();
  });
});

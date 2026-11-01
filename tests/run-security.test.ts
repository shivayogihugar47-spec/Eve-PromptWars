import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: Object.assign(mocks.sql, { transaction: mocks.transaction }),
}));

import { saveLockedRun } from "@/lib/run/security";
import type { RunPlan } from "@/lib/run/types";

const taskId = "00000000-0000-4000-8000-000000000001";

describe("RUN owner-link persistence", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.transaction.mockReset().mockResolvedValue([]);
  });

  it("serializes the required database column names and expiration", async () => {
    const plan: RunPlan = {
      eventType: "birthday",
      eventDate: "2026-11-02",
      guestCount: 30,
      city: "Belagavi",
      budgetTotal: 5000,
      accessibilityNeeds: "Wheelchair access and vegetarian meals",
      ageMix: "A mix of ages",
      timeline: [{
        id: taskId,
        task: "Prepare the venue",
        time: "9:00 AM",
        startAt: "2026-11-02T09:00:00.000Z",
        durationMin: 30,
        dependsOn: [],
        owner: "Event team",
        status: "pending",
        icon: "building",
      }],
      budgetBreakdown: [{ category: "Venue", allocated: 5000, percentage: 100, icon: "building" }],
      vendors: [],
      checklist: [],
    };

    await saveLockedRun(plan, {}, [], "test-user-id");

    const values = mocks.sql.mock.calls.flatMap((call) => call.slice(1));
    const eventInsert = mocks.sql.mock.calls.find((call) =>
      call[0].join("").includes("owner_user_id"),
    );
    expect(eventInsert?.[0].join("")).toContain("organizer_token_expires_at");
    expect(eventInsert?.slice(1)).toContain("test-user-id");
    const organizerTokenExpiresAt = Date.parse(String(eventInsert?.[7]));
    expect(organizerTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(organizerTokenExpiresAt).toBeLessThan(Date.now() + 91 * 24 * 60 * 60_000);
    const ownerLinksJson = values.find(
      (value): value is string => typeof value === "string" && value.includes('"expires_at"'),
    );
    expect(ownerLinksJson).toBeDefined();
    const ownerLinks = JSON.parse(ownerLinksJson!);
    expect(ownerLinks).toHaveLength(1);
    expect(ownerLinks[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ownerLinks[0]).toMatchObject({
      token: expect.any(String),
      task_ids: [taskId],
      expires_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(ownerLinks[0].expires_at))).toBe(false);
    expect(Date.parse(ownerLinks[0].expires_at)).toBeGreaterThan(Date.now());
    expect(Date.parse(ownerLinks[0].expires_at)).toBeLessThan(Date.now() + 91 * 24 * 60 * 60_000);
    expect(ownerLinks[0]).not.toHaveProperty("taskIds");
    expect(ownerLinks[0]).not.toHaveProperty("expiresAt");
  });
});

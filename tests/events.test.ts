import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/auth/server", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { GET } from "@/app/api/events/route";

describe("saved events API", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.getAuthenticatedUser.mockReset();
  });

  it("requires a signed-in account", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("lists only events belonging to the signed-in user", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "account-123" });
    mocks.sql.mockResolvedValue([{
      id: "event-123",
      event_type: "wedding",
      event_date: "2026-11-02",
      city: "Belagavi",
      budget_total: "250000",
      current_plan_version: 2,
      created_at: "2026-10-30T12:00:00.000Z",
    }]);

    const response = await GET();
    const result = await response.json();
    const [query, accountId] = mocks.sql.mock.calls[0];

    expect(response.status).toBe(200);
    expect(result.events).toEqual([{
      id: "event-123",
      eventType: "wedding",
      eventDate: "2026-11-02",
      city: "Belagavi",
      budgetTotal: 250000,
      version: 2,
      createdAt: "2026-10-30T12:00:00.000Z",
    }]);
    expect(query.join("")).toContain("WHERE e.owner_user_id =");
    expect(accountId).toBe("account-123");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  transaction: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: Object.assign(mocks.sql, { transaction: mocks.transaction }),
}));
vi.mock("@/lib/auth/server", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import {
  consumeRateLimit,
  createBearerToken,
  loadOrganizerRun,
  loadOwnerRun,
  loadOwnedOrganizerRun,
  publicRateLimitIdentity,
  rateLimitIdentity,
  saveLockedRun,
} from "@/lib/run/security";
import type { RunPlan } from "@/lib/run/types";

const taskId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000099";

function makePlan(): RunPlan {
  return {
    eventType: "community",
    eventDate: "2026-11-02",
    guestCount: 30,
    city: "Belagavi",
    budgetTotal: 5000,
    accessibilityNeeds: "Step-free access",
    ageMix: "A mix of ages",
    timeline: [],
    budgetBreakdown: [],
    vendors: [],
    checklist: [],
  };
}

function organizerRequest(token: string): Request {
  return new Request("https://eve.test", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("RUN owner-link persistence", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.transaction.mockReset().mockResolvedValue([]);
    mocks.getAuthenticatedUser.mockReset().mockResolvedValue(null);
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

describe("RUN token and access checks", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.transaction.mockReset();
    mocks.getAuthenticatedUser.mockReset().mockResolvedValue(null);
  });

  it("creates independent URL-safe bearer tokens with 256 bits of entropy", () => {
    const first = createBearerToken();
    const second = createBearerToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("uses only the first forwarded IP for public rate limits and hashes identities", () => {
    const first = publicRateLimitIdentity(new Request("https://eve.test", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    }));
    const sameClient = publicRateLimitIdentity(new Request("https://eve.test", {
      headers: { "x-forwarded-for": "203.0.113.7, 192.0.2.1" },
    }));
    const differentClient = publicRateLimitIdentity(new Request("https://eve.test", {
      headers: { "x-forwarded-for": "203.0.113.8" },
    }));

    expect(first).toHaveLength(64);
    expect(first).toBe(sameClient);
    expect(first).not.toBe(differentClient);
    expect(first).not.toContain("203.0.113.7");
  });

  it("hashes organizer credentials rather than exposing them in rate-limit identities", () => {
    const token = createBearerToken();
    const first = rateLimitIdentity(organizerRequest(token));
    const sameToken = rateLimitIdentity(organizerRequest(token));
    const differentToken = rateLimitIdentity(organizerRequest(createBearerToken()));

    expect(first).toHaveLength(64);
    expect(first).toBe(sameToken);
    expect(first).not.toBe(differentToken);
    expect(first).not.toContain(token);
  });

  it("requires a valid event UUID and an organizer bearer token before querying", async () => {
    await expect(loadOrganizerRun(organizerRequest("token"), "not-an-id"))
      .rejects.toThrow("Event not found");
    await expect(loadOrganizerRun(new Request("https://eve.test"), eventId))
      .rejects.toThrow("Organizer authorization is required");

    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("accepts an unexpired organizer token only when its hash matches", async () => {
    const token = createBearerToken();
    const plan = makePlan();
    mocks.sql
      .mockResolvedValueOnce([{
        organizer_token_hash: createHash("sha256").update(token).digest("hex"),
        organizer_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        current_plan_version: 3,
        answers: { city: "Belagavi" },
      }])
      .mockResolvedValueOnce([{ plan }]);

    await expect(loadOrganizerRun(organizerRequest(token), eventId)).resolves.toEqual({
      eventId,
      version: 3,
      plan,
      answers: { city: "Belagavi" },
      organizerToken: token,
    });

    mocks.sql.mockReset()
      .mockResolvedValueOnce([{
        organizer_token_hash: createHash("sha256").update(token).digest("hex"),
        organizer_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        current_plan_version: 3,
        answers: {},
      }]);
    await expect(loadOrganizerRun(organizerRequest(createBearerToken()), eventId))
      .rejects.toThrow("Organizer authorization is invalid.");

    mocks.sql.mockReset()
      .mockResolvedValueOnce([{
        organizer_token_hash: createHash("sha256").update(token).digest("hex"),
        organizer_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
        current_plan_version: 3,
        answers: {},
      }]);
    await expect(loadOrganizerRun(organizerRequest(createBearerToken()), eventId))
      .rejects.toThrow("invalid or expired");
    expect(mocks.sql).toHaveBeenCalledOnce();
  });

  it("loads an owner link only when its token and current plan exist", async () => {
    const token = createBearerToken();
    const plan = makePlan();
    await expect(loadOwnerRun("short-token")).rejects.toThrow("invalid or expired");
    expect(mocks.sql).not.toHaveBeenCalled();

    mocks.sql
      .mockResolvedValueOnce([{ event_id: eventId, task_ids: [taskId] }])
      .mockResolvedValueOnce([{ current_plan_version: 2 }])
      .mockResolvedValueOnce([{ plan }]);
    await expect(loadOwnerRun(token)).resolves.toEqual({
      eventId,
      version: 2,
      plan,
      taskIds: [taskId],
    });
  });

  it("allows an authenticated owner to load their run when bearer access is unavailable", async () => {
    const plan = makePlan();
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner-1" });
    mocks.sql
      .mockResolvedValueOnce([{ owner_user_id: "owner-1", current_plan_version: 4, answers: {} }])
      .mockResolvedValueOnce([{ plan }]);

    await expect(loadOwnedOrganizerRun(new Request("https://eve.test"), eventId)).resolves.toEqual({
      eventId,
      version: 4,
      plan,
      answers: {},
      organizerToken: "",
    });
  });

  it("enforces the rate limit at its boundary and expires old windows", async () => {
    mocks.sql.mockResolvedValueOnce([{ hits: 2 }]).mockResolvedValueOnce([]);

    await expect(consumeRateLimit("visitor", 2)).resolves.toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
    expect(mocks.sql.mock.calls[0][0].join("")).toContain("ON CONFLICT");
    expect(mocks.sql.mock.calls[1][0].join("")).toContain("interval '10 minutes'");

    mocks.sql.mockReset().mockResolvedValueOnce([{ hits: 3 }]).mockResolvedValueOnce([]);
    await expect(consumeRateLimit("visitor", 2)).resolves.toBe(false);

    mocks.sql.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(consumeRateLimit("visitor", 2)).resolves.toBe(false);
  });
});

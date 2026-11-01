import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  llmJson: vi.fn(),
  generateRisks: vi.fn(),
  saveLockedRun: vi.fn(),
  consumeRateLimit: vi.fn(),
  publicRateLimitIdentity: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({ llmJson: mocks.llmJson }));
vi.mock("@/lib/run/risks", () => ({ generateRisks: mocks.generateRisks }));
vi.mock("@/lib/run/security", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  publicRateLimitIdentity: mocks.publicRateLimitIdentity,
  saveLockedRun: mocks.saveLockedRun,
}));
vi.mock("@/lib/auth", () => ({ authConfig: { isConfigured: false } }));
vi.mock("@/lib/auth/server", () => ({ getAuthenticatedUser: vi.fn() }));

import { POST } from "@/app/api/chat/route";
import type { EventPlan } from "@/app/api/chat/route";

const requiredPlanData = {
  eventType: "community",
  eventDate: "2027-05-01",
  guestCount: "50-100",
  city: "Belagavi",
  budgetTotal: "₹1L",
  accessibilityNeeds: "Step-free routes, elderly seating, and vegan meals",
  ageMix: "A mix of ages",
  theme: "Community garden",
  venueStyle: "Outdoor garden",
  cateringType: "Vegetarian",
  specialRequirements: "Keep activities family-friendly",
  eventDetails: {},
};

function createGeneratedPlan(): EventPlan {
  return {
    eventType: "community",
    eventDate: "2027-05-01",
    guestCount: 75,
    city: "Belagavi",
    budgetTotal: 100_000,
    theme: "Community garden",
    venueStyle: "Outdoor garden",
    cateringType: "Vegetarian",
    specialRequirements: "Keep activities family-friendly",
    accessibilityNeeds: requiredPlanData.accessibilityNeeds,
    ageMix: requiredPlanData.ageMix,
    eventDetails: {},
    highlights: ["Accessible garden", "Community meal", "Family activities", "Local stories"],
    timeline: Array.from({ length: 12 }, (_, index) => ({
      time: `${String(8 + index).padStart(2, "0")}:00`,
      task: `Community event activity ${index + 1}`,
      owner: "Organizer",
      description: "Coordinate with the event team.",
      status: "pending" as const,
      icon: "clock",
    })),
    budgetBreakdown: Array.from({ length: 8 }, (_, index) => ({
      category: `Category ${index + 1}`,
      allocated: 12_500,
      percentage: 12.5,
      icon: "wallet",
    })),
    vendors: Array.from({ length: 10 }, (_, index) => ({
      name: `Service category ${index + 1}`,
      category: `Category ${index + 1}`,
      description: "Planning option tailored to the guest group.",
      status: "pending" as const,
      priority: "medium" as const,
      icon: "sparkles",
      estimatedCost: "₹5,000",
    })),
    checklist: Array.from({ length: 12 }, (_, index) => ({
      task: `Planning task ${index + 1}`,
      dueDate: "One week before",
      done: false,
      icon: "check",
      category: "Venue",
    })),
  };
}

function createRequest(
  body: unknown,
  headers: HeadersInit = { "Content-Type": "application/json" },
): Request {
  return new Request("https://eve.test/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("/api/chat plan generation", () => {
  beforeEach(() => {
    mocks.llmJson.mockReset();
    mocks.generateRisks.mockReset();
    mocks.saveLockedRun.mockReset();
    mocks.consumeRateLimit.mockReset().mockResolvedValue(true);
    mocks.publicRateLimitIdentity.mockReset().mockReturnValue("visitor");
    mocks.saveLockedRun.mockResolvedValue({ eventId: "event-123", version: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates accessibility and age-mix answers before calling AI", async () => {
    const response = await POST(createRequest({
      messages: [],
      generatePlan: true,
      planData: { ...requiredPlanData, accessibilityNeeds: null },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Answer the accessibility and age-mix questions before generating your plan.",
    });
    expect(mocks.llmJson).not.toHaveBeenCalled();
    expect(mocks.saveLockedRun).not.toHaveBeenCalled();
  });

  it("returns a generated plan with balanced budget and event-specific contingencies", async () => {
    const generatedPlan = createGeneratedPlan();
    const risks = [{
      title: "Rain during the garden welcome",
      triggerType: "WEATHER",
      likelihood: "medium",
      backupAction: [{ type: "shift", taskId: "00000000-0000-4000-8000-000000000001", minutes: 15 }],
      status: "ready",
    }];
    mocks.llmJson.mockResolvedValue(generatedPlan);
    mocks.generateRisks.mockResolvedValue(risks);

    const response = await POST(createRequest({
      messages: [],
      generatePlan: true,
      planData: requiredPlanData,
    }));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.plan.accessibilityNeeds).toBe(requiredPlanData.accessibilityNeeds);
    expect(result.plan.ageMix).toBe(requiredPlanData.ageMix);
    expect(result.plan.budgetBreakdown.reduce(
      (sum: number, item: { allocated: number }) => sum + item.allocated,
      0,
    )).toBe(100_000);
    expect(result.run.risks).toEqual(risks);
    expect(mocks.llmJson).toHaveBeenCalledOnce();
    expect(mocks.generateRisks).toHaveBeenCalledOnce();
    expect(mocks.saveLockedRun).toHaveBeenCalledOnce();
  });

  it("does not save a plan when contingency generation fails", async () => {
    mocks.llmJson.mockResolvedValue(createGeneratedPlan());
    mocks.generateRisks.mockRejectedValue(new Error("provider response details"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(createRequest({
      messages: [],
      generatePlan: true,
      planData: requiredPlanData,
    }));
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toContain("Plan B contingencies");
    expect(JSON.stringify(result)).not.toContain("provider response details");
    expect(mocks.saveLockedRun).not.toHaveBeenCalled();
  });

  it("stops before AI work when the visitor rate limit is reached", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);

    const response = await POST(createRequest({
      messages: [],
      generatePlan: true,
      planData: requiredPlanData,
    }));

    expect(response.status).toBe(429);
    expect(mocks.llmJson).not.toHaveBeenCalled();
    expect(mocks.generateRisks).not.toHaveBeenCalled();
    expect(mocks.saveLockedRun).not.toHaveBeenCalled();
  });

  it("uses the deterministic question flow without an LLM call", async () => {
    const response = await POST(createRequest({
      messages: [{ role: "user", content: "Birthday" }],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      card: { step: 2, title: "When is the big day?" },
    });
    expect(mocks.llmJson).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { normalizeBudgetAmounts, formatINR, parseBudget } from "../lib/budget";

describe("Plan Logic", () => {
  it("should parse budget strings correctly", () => {
    expect(parseBudget("₹3-7L")).toBe(500000);
    expect(parseBudget("₹15L+")).toBe(1500000);
    expect(parseBudget("Under ₹1L")).toBe(50000);
    expect(parseBudget("Under ₹25,000")).toBe(12500);
    expect(parseBudget("₹25,000–₹50,000")).toBe(37500);
    expect(parseBudget("₹50,000–₹1L")).toBe(75000);
    expect(parseBudget("₹50L–₹1Cr")).toBe(7500000);
    expect(parseBudget("₹1Cr+")).toBe(10000000);
    expect(parseBudget("₹75,000")).toBe(75000);
  });

  it("formats Indian budgets in rupees, thousands, lakhs, and crores", () => {
    expect(formatINR(750)).toBe("₹750");
    expect(formatINR(37500)).toBe("₹37.5K");
    expect(formatINR(750000)).toBe("₹7.5L");
    expect(formatINR(10000000)).toBe("₹1Cr");
  });

  it("keeps generated budget allocations equal to the selected total", () => {
    const breakdown = normalizeBudgetAmounts([
      { category: "Venue", allocated: 700, percentage: 70 },
      { category: "Food", allocated: 300, percentage: 30 },
    ], 37500);

    expect(breakdown.map((item) => item.allocated)).toEqual([26250, 11250]);
    expect(breakdown.reduce((sum, item) => sum + item.allocated, 0)).toBe(37500);
  });
});

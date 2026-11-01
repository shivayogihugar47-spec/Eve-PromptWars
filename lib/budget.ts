const budgetAmounts = [
  "Under ₹25,000",
  "₹25,000–₹50,000",
  "₹50,000–₹1L",
  "₹1–3L",
  "₹3–7L",
  "₹7–15L",
  "₹15–30L",
  "₹30–50L",
  "₹50L–₹1Cr",
  "₹1Cr+",
] as const;

export const BUDGET_OPTIONS = budgetAmounts.map((label) => ({ label, value: label }));

export function parseBudget(value: string): number {
  const normalized = value.replace(/,/g, "");
  const matches = Array.from(
    normalized.matchAll(/(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|l|thousands?|k)?/gi),
  );
  if (matches.length === 0) return 0;

  const amounts = matches.map((match, index) => {
    const rawAmount = Number(match[1]);
    const inheritedUnit = rawAmount < 1_000
      ? matches[index + 1]?.[2] || matches[index - 1]?.[2] || ""
      : "";
    const unit = (match[2] || inheritedUnit).toLowerCase();
    const multiplier = unit.startsWith("c") ? 10_000_000
      : unit.startsWith("l") ? 100_000
      : unit.startsWith("k") || unit.startsWith("thousand") ? 1_000
      : 1;
    return rawAmount * multiplier;
  });

  if (amounts.some((amount) => !Number.isFinite(amount))) return 0;

  let amount: number;
  if (/\bunder\b|</i.test(normalized)) {
    amount = amounts[0] / 2;
  } else if (/\+|\b(?:and above|or more)\b/i.test(normalized)) {
    amount = amounts[0];
  } else if (amounts.length > 1) {
    amount = (amounts[0] + amounts[1]) / 2;
  } else {
    amount = amounts[0];
  }

  return Math.round(amount);
}

export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return "₹0";

  const absoluteAmount = Math.abs(amount);
  const scaled = absoluteAmount >= 10_000_000 ? amount / 10_000_000
    : absoluteAmount >= 100_000 ? amount / 100_000
    : absoluteAmount >= 1_000 ? amount / 1_000
    : amount;
  const suffix = absoluteAmount >= 10_000_000 ? "Cr"
    : absoluteAmount >= 100_000 ? "L"
    : absoluteAmount >= 1_000 ? "K"
    : "";
  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: suffix === "K" ? 1 : 2,
  }).format(scaled);

  return `₹${formatted}${suffix}`;
}

export function normalizeBudgetAmounts<T extends { allocated: number; percentage: number }>(
  items: T[],
  total: number,
): T[] {
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error("The selected event budget must be a positive INR amount.");
  }
  if (items.length === 0) {
    throw new Error("The generated budget breakdown must include at least one category.");
  }

  const allocationTotal = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.allocated) ? Math.max(0, item.allocated) : 0),
    0,
  );
  const percentageTotal = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.percentage) ? Math.max(0, item.percentage) : 0),
    0,
  );
  const weights = items.map((item) => allocationTotal > 0
    ? (Number.isFinite(item.allocated) ? Math.max(0, item.allocated) : 0)
    : (Number.isFinite(item.percentage) ? Math.max(0, item.percentage) : 0));
  const weightTotal = allocationTotal > 0 ? allocationTotal : percentageTotal;

  if (weightTotal <= 0) {
    throw new Error("The generated budget breakdown has no usable allocation weights.");
  }

  let allocatedSoFar = 0;
  return items.map((item, index) => {
    const allocated = index === items.length - 1
      ? total - allocatedSoFar
      : Math.round((weights[index] / weightTotal) * total);
    allocatedSoFar += allocated;

    return {
      ...item,
      allocated,
      percentage: Math.round((allocated / total) * 100),
    };
  });
}

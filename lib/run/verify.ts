import { analyzeImpact, applyChanges, applyOperations, detectViolations } from "./impact";
import { OperationSchema, type ImpactReport, type RunChange, type RunOption, type RunPlan, type VerifiedOption } from "./types";

function operationTargetsExist(plan: RunPlan, operations: RunOption["operations"]): boolean {
  const ids = new Set(plan.timeline.map((task) => task.id));
  return operations.every((operation) => operation.type === "add_task"
    ? operation.dependsOn.every((id) => ids.has(id))
    : ids.has(operation.taskId)
      && (operation.type !== "parallelize" || ids.has(operation.withTaskId)));
}

export function verifyOptions(
  currentPlan: RunPlan,
  changes: RunChange[],
  impact: ImpactReport,
  options: RunOption[],
): { verified: VerifiedOption[]; failures: string[] } {
  const changedPlan = applyChanges(currentPlan, changes);
  const failures: string[] = [];
  const verified: VerifiedOption[] = [];

  for (const rawOption of options) {
    const parsedOperations = rawOption.operations.map((operation) => OperationSchema.safeParse(operation));
    const invalidOperation = parsedOperations.find((result) => !result.success);
    if (invalidOperation && !invalidOperation.success) {
      failures.push(`${rawOption.title}: contains an invalid operation (${invalidOperation.error.issues.map((issue) => issue.message).join("; ")}).`);
      continue;
    }
    const option = {
      ...rawOption,
      operations: parsedOperations.map((result) => result.success ? result.data : null)
        .filter((operation): operation is NonNullable<typeof operation> => operation !== null),
    };
    if (!operationTargetsExist(changedPlan, option.operations)) {
      failures.push(`${option.title}: references a task outside the current plan.`);
      continue;
    }

    const candidate = applyOperations(changedPlan, option.operations);
    const report = analyzeImpact(currentPlan, changes, candidate);
    const violations = detectViolations(candidate);
    const guestCost = report.budgetDelta - (candidate.budgetTotal - currentPlan.budgetTotal);
    const budgetCapacity = Math.max(0, candidate.budgetTotal - currentPlan.budgetBreakdown.reduce((sum, item) => sum + item.allocated, 0));
    const exceedsBudget = guestCost + option.rupeeImpact > budgetCapacity;
    if (exceedsBudget && !violations.some((violation) => violation.type === "budget")) {
      violations.push({ type: "budget", message: "This option exceeds available budget after the change." });
    }

    if (violations.length > 0) {
      failures.push(`${option.title}: ${violations.map((violation) => violation.message).join(" ")}`);
      continue;
    }
    verified.push({ ...option, plan: candidate, report, });
  }

  return { verified, failures };
}

function dependencyRoots(plan: RunPlan, taskId: string): string[] {
  const tasksById = new Map(plan.timeline.map((task) => [task.id, task]));
  const roots = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const task = tasksById.get(id);
    if (!task) return;
    const dependencies = task.dependsOn
      .map((dependencyId) => tasksById.get(dependencyId))
      .filter((dependency): dependency is RunPlan["timeline"][number] =>
        Boolean(dependency && dependency.status !== "cancelled"),
      );
    if (dependencies.length === 0) {
      roots.add(task.id);
      return;
    }
    dependencies.forEach((dependency) => visit(dependency.id));
  };

  visit(taskId);
  return Array.from(roots);
}

export function deterministicShiftOption(
  currentPlan: RunPlan,
  changes: RunChange[],
  impact: ImpactReport,
): RunOption | null {
  const changedPlan = applyChanges(currentPlan, changes);
  const violations = detectViolations(changedPlan);
  const shiftByTask = new Map<string, number>();

  for (const violation of violations) {
    if (!violation.taskId || (violation.type !== "venue_close" && violation.type !== "event_end")) return null;
    const task = changedPlan.timeline.find((entry) => entry.id === violation.taskId);
    if (!task) return null;
    const end = Date.parse(task.startAt) + task.durationMin * 60_000;
    let deadline: number;
    if (violation.type === "event_end" && changedPlan.constraints?.eventEndsAt) {
      deadline = Date.parse(changedPlan.constraints.eventEndsAt);
    } else {
      const close = changedPlan.constraints?.venueClosesAt;
      if (!close) return null;
      deadline = Date.parse(`${changedPlan.eventDate}T${close}:00Z`);
    }
    if (!Number.isFinite(deadline)) return null;
    const shift = -Math.ceil((end - deadline) / 60_000);
    for (const rootId of dependencyRoots(changedPlan, task.id)) {
      shiftByTask.set(rootId, Math.min(shiftByTask.get(rootId) ?? 0, shift));
    }
  }

  if (shiftByTask.size === 0) {
    const delayed = changes.find((change) => change.type === "DELAY" && change.taskId);
    if (!delayed?.taskId || impact.criticalPath.length === 0) return null;
    const task = changedPlan.timeline.find((entry) => entry.id === delayed.taskId);
    if (!task) return null;
    const slack = impact.slackMinutes[task.id] ?? 0;
    const shift = -Math.min(delayed.minutes ?? 15, slack);
    for (const rootId of dependencyRoots(changedPlan, task.id)) {
      shiftByTask.set(rootId, Math.min(shiftByTask.get(rootId) ?? 0, shift));
    }
  }

  const operations = Array.from(shiftByTask, ([taskId, minutes]) => ({ type: "shift" as const, taskId, minutes }));
  if (operations.every((operation) => operation.minutes === 0)) return null;
  const candidate = applyOperations(changedPlan, operations);
  if (detectViolations(candidate).length > 0) return null;
  return {
    title: "Dependency-safe schedule adjustment",
    operations,
    tradeoffs: ["Moves the affected task chain earlier while preserving its dependencies; no vendor or budget changes."],
    rupeeImpact: 0,
    source: "deterministic",
  };
}

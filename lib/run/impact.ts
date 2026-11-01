import { ChangeSchema, type ImpactReport, type RunChange, type RunPlan, type RunTask } from "./types";

const minutes = 60_000;

function taskStart(task: RunTask): number {
  const parsed = Date.parse(task.startAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskDuration(task: RunTask): number {
  return Number.isFinite(task.durationMin) && task.durationMin > 0 ? task.durationMin : 30;
}

function updateTimeLabel(task: RunTask): void {
  task.time = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(task.startAt));
}

function findTask(plan: RunPlan, change: RunChange): RunTask | undefined {
  if (change.taskId) return plan.timeline.find((task) => task.id === change.taskId);
  if (!change.taskName && !change.vendorName) return undefined;
  const query = (change.taskName ?? change.vendorName ?? "").toLowerCase();
  return plan.timeline.find((task) =>
    task.task.toLowerCase().includes(query)
    || query.includes(task.task.toLowerCase())
    || task.vendorName?.toLowerCase().includes(query),
  );
}

function descendants(tasks: RunTask[], rootIds: Set<string>): Set<string> {
  const affected = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (!affected.has(task.id) && task.dependsOn.some((id) => affected.has(id))) {
        affected.add(task.id);
        changed = true;
      }
    }
  }
  return affected;
}

function shiftTaskAndDescendants(plan: RunPlan, taskId: string, deltaMinutes: number): void {
  const affected = descendants(plan.timeline, new Set([taskId]));
  for (const task of plan.timeline) {
    if (!affected.has(task.id)) continue;
    task.startAt = new Date(taskStart(task) + deltaMinutes * minutes).toISOString();
    updateTimeLabel(task);
  }
}

function criticalPath(tasks: RunTask[]): { ids: string[]; slack: Record<string, number> } {
  const active = tasks.filter((task) => task.status !== "cancelled");
  const byId = new Map(active.map((task) => [task.id, task]));
  const children = new Map<string, string[]>();
  const dependencies = new Map<string, number>();
  for (const task of active) {
    const taskDependencies = task.dependsOn.filter((id) => byId.has(id));
    dependencies.set(task.id, taskDependencies.length);
    for (const dependencyId of taskDependencies) {
      children.set(dependencyId, [...(children.get(dependencyId) ?? []), task.id]);
    }
  }
  const ready = active
    .filter((task) => dependencies.get(task.id) === 0)
    .sort((a, b) => taskStart(a) - taskStart(b));
  const ordered: RunTask[] = [];
  while (ready.length > 0) {
    const task = ready.shift()!;
    ordered.push(task);
    for (const childId of children.get(task.id) ?? []) {
      const remaining = (dependencies.get(childId) ?? 1) - 1;
      dependencies.set(childId, remaining);
      if (remaining === 0) {
        const child = byId.get(childId);
        if (child) {
          ready.push(child);
          ready.sort((a, b) => taskStart(a) - taskStart(b));
        }
      }
    }
  }
  if (ordered.length !== active.length) {
    const orderedIds = new Set(ordered.map((task) => task.id));
    ordered.push(...active.filter((task) => !orderedIds.has(task.id)).sort((a, b) => taskStart(a) - taskStart(b)));
  }
  const earliestFinish = new Map<string, number>();
  const earliestStart = new Map<string, number>();

  for (const task of ordered) {
    const dependencyFinish = task.dependsOn
      .filter((id) => byId.has(id))
      .reduce((latest, id) => Math.max(latest, earliestFinish.get(id) ?? taskStart(byId.get(id)!)), taskStart(task));
    const start = Math.max(taskStart(task), dependencyFinish);
    earliestStart.set(task.id, start);
    earliestFinish.set(task.id, start + taskDuration(task) * minutes);
  }

  const projectEnd = Math.max(0, ...Array.from(earliestFinish.values()));
  const latestStart = new Map<string, number>();
  for (const task of [...ordered].reverse()) {
    const successorStarts = ordered
      .filter((candidate) => candidate.dependsOn.includes(task.id))
      .map((candidate) => latestStart.get(candidate.id) ?? projectEnd);
    const latestEnd = successorStarts.length ? Math.min(...successorStarts) : projectEnd;
    latestStart.set(task.id, latestEnd - taskDuration(task) * minutes);
  }

  const slack = Object.fromEntries(ordered.map((task) => [
    task.id,
    Math.max(0, Math.round(((latestStart.get(task.id) ?? projectEnd) - (earliestStart.get(task.id) ?? taskStart(task))) / minutes)),
  ]));
  return { ids: ordered.filter((task) => slack[task.id] === 0).map((task) => task.id), slack };
}

function venueCloseInstant(plan: RunPlan): number | undefined {
  const close = plan.constraints?.venueClosesAt;
  if (!close) return undefined;
  const [hours, mins] = close.split(":").map(Number);
  const eventDate = plan.eventDate || new Date().toISOString().slice(0, 10);
  const instant = Date.parse(`${eventDate}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00Z`);
  return Number.isFinite(instant) ? instant : undefined;
}

export function detectViolations(plan: RunPlan): ImpactReport["violations"] {
  const violations: ImpactReport["violations"] = [];
  const byId = new Map(plan.timeline.map((task) => [task.id, task]));
  const closeAt = venueCloseInstant(plan);
  const eventEnd = plan.constraints?.eventEndsAt ? Date.parse(plan.constraints.eventEndsAt) : undefined;

  for (const task of plan.timeline) {
    if (task.status === "cancelled") continue;
    const start = taskStart(task);
    const end = start + taskDuration(task) * minutes;
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (dependency?.status === "cancelled" && task.status !== "done") {
        violations.push({ type: "dependency", taskId: task.id, message: `${task.task} depends on cancelled task ${dependency.task}.` });
      } else if (dependency && dependency.status !== "cancelled" && start < taskStart(dependency) + taskDuration(dependency) * minutes) {
        violations.push({ type: "dependency", taskId: task.id, message: `${task.task} starts before ${dependency.task} finishes.` });
      }
    }
    if (closeAt !== undefined && end > closeAt) {
      violations.push({ type: "venue_close", taskId: task.id, message: `${task.task} ends after the venue closes.` });
    }
    if (eventEnd !== undefined && Number.isFinite(eventEnd) && end > eventEnd) {
      violations.push({ type: "event_end", taskId: task.id, message: `${task.task} ends after the event end time.` });
    }
    const vendorWindow = task.vendorName ? plan.constraints?.vendorWindows?.[task.vendorName] : undefined;
    if (vendorWindow && (start < Date.parse(vendorWindow.startAt) || end > Date.parse(vendorWindow.endAt))) {
      violations.push({ type: "vendor_window", taskId: task.id, message: `${task.task} falls outside ${task.vendorName}'s time window.` });
    }
  }

  const allocated = plan.budgetBreakdown.reduce((sum, item) => sum + Math.max(0, item.allocated), 0);
  if (allocated > plan.budgetTotal) {
    violations.push({ type: "budget", message: "Planned allocations exceed the event budget." });
  }
  return violations;
}

export function applyChanges(plan: RunPlan, rawChanges: RunChange[]): RunPlan {
  const changes = rawChanges.map((change) => ChangeSchema.parse(change));
  const next: RunPlan = structuredClone(plan);
  for (const change of changes) {
    const task = findTask(next, change);
    switch (change.type) {
      case "DELAY":
        if (task) shiftTaskAndDescendants(next, task.id, change.minutes ?? 15);
        break;
      case "VENDOR_CANCELLED":
        if (task) task.status = "cancelled";
        break;
      case "VENDOR_REPLACED":
        if (task && change.replacementVendor) task.vendorName = change.replacementVendor;
        break;
      case "GUEST_COUNT":
        if (change.guestCount !== undefined) next.guestCount = change.guestCount;
        break;
      case "BUDGET":
        if (change.budgetTotal !== undefined) next.budgetTotal = change.budgetTotal;
        break;
      case "DATE_MOVE":
        if (change.eventDate) {
          const currentDate = Date.parse(`${next.eventDate}T00:00:00Z`);
          const movedDate = Date.parse(`${change.eventDate}T00:00:00Z`);
          const delta = Number.isFinite(currentDate) ? movedDate - currentDate : 0;
          next.timeline.forEach((entry) => {
            entry.startAt = new Date(taskStart(entry) + delta).toISOString();
            updateTimeLabel(entry);
          });
          next.eventDate = change.eventDate;
        }
        break;
      case "VENUE_ISSUE":
        if (change.venueClosesAt) {
          next.constraints = { ...next.constraints, venueClosesAt: change.venueClosesAt };
        }
        break;
      case "WEATHER":
      case "TASK_DONE":
        if (task && change.type === "TASK_DONE") {
          task.status = "done";
          task.actualAt = change.actualAt ?? new Date().toISOString();
        }
        break;
    }
  }
  return next;
}

export function analyzeImpact(
  currentPlan: RunPlan,
  changes: RunChange[],
  candidatePlan = applyChanges(currentPlan, changes),
): ImpactReport {
  const originalTimes = new Map(currentPlan.timeline.map((task) => [task.id, task.startAt]));
  const beforeCount = currentPlan.guestCount;
  const perGuest = beforeCount > 0 ? currentPlan.budgetTotal / beforeCount : 0;
  const guestDelta = candidatePlan.guestCount - beforeCount;
  const budgetDelta = Math.round(guestDelta * perGuest)
    + candidatePlan.budgetTotal - currentPlan.budgetTotal;
  const affectedIds = new Set<string>();

  for (const change of changes) {
    const root = findTask(candidatePlan, change);
    if (root) affectedIds.add(root.id);
    if ((change.type === "DELAY" || change.type === "VENDOR_CANCELLED") && root) {
      descendants(candidatePlan.timeline, new Set([root.id])).forEach((id) => affectedIds.add(id));
    }
    if (change.type === "DATE_MOVE") candidatePlan.timeline.forEach((task) => affectedIds.add(task.id));
    if (change.type === "GUEST_COUNT" || change.type === "BUDGET" || change.type === "WEATHER" || change.type === "VENUE_ISSUE") {
      candidatePlan.timeline.filter((task) => task.status !== "cancelled").forEach((task) => affectedIds.add(task.id));
    }
  }

  const tasksById = new Map(candidatePlan.timeline.map((task) => [task.id, task]));
  const affectedTasks = Array.from(affectedIds)
    .map((id) => tasksById.get(id))
    .filter((task): task is RunTask => Boolean(task))
    .map((task) => ({
      id: task.id,
      task: task.task,
      reason: changes.map((change) => change.note ?? change.type.toLowerCase().replaceAll("_", " ")).join(", "),
    }));
  const newTimes = candidatePlan.timeline.flatMap((task) => {
    const before = originalTimes.get(task.id);
    return before && before !== task.startAt ? [{ taskId: task.id, before, after: task.startAt }] : [];
  });
  const critical = criticalPath(candidatePlan.timeline);
  const violations = detectViolations(candidatePlan);
  const severity = violations.length > 0 || changes.some((change) => change.type === "WEATHER" || change.type === "VENUE_ISSUE")
    ? "high"
    : affectedTasks.length > 3 || budgetDelta !== 0
      ? "medium"
      : "low";

  return { affectedTasks, newTimes, criticalPath: critical.ids, slackMinutes: critical.slack, budgetDelta, violations, severity };
}

export function planWithOperation(
  plan: RunPlan,
  operation: import("./types").RunOperation,
): RunPlan {
  const next = structuredClone(plan);
  const task = operation.type === "add_task"
    ? undefined
    : next.timeline.find((entry) => entry.id === operation.taskId);
  switch (operation.type) {
    case "shift":
      if (task) shiftTaskAndDescendants(next, task.id, operation.minutes);
      break;
    case "shorten":
      if (task) task.durationMin = Math.max(1, taskDuration(task) - operation.minutes);
      break;
    case "parallelize":
      if (task) task.dependsOn = task.dependsOn.filter((id) => id !== operation.withTaskId);
      break;
    case "drop":
      if (task) task.status = "cancelled";
      break;
    case "swap_vendor":
      if (task) {
        task.vendorName = operation.vendorName;
        if (task.status === "cancelled") task.status = "pending";
      }
      break;
    case "reassign":
      if (task) task.owner = operation.owner;
      break;
    case "add_task": {
      const added: RunTask = {
        id: crypto.randomUUID(),
        task: operation.task,
        owner: operation.owner,
        time: new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(operation.startAt)),
        startAt: operation.startAt,
        durationMin: operation.durationMin,
        dependsOn: operation.dependsOn,
        status: "pending",
        icon: "clock",
      };
      next.timeline.push(added);
      break;
    }
  }
  return next;
}

export function applyOperations(plan: RunPlan, operations: import("./types").RunOperation[]): RunPlan {
  return operations.reduce(planWithOperation, structuredClone(plan));
}

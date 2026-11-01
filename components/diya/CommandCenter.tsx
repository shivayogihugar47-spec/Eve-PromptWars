"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, Clock, CloudRain, Copy, ListChecks,
  MapPin, PartyPopper, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Users,
  Wifi, WifiOff,
} from "lucide-react";
import { Diya } from "./Diya";
import { DiyaJourneyStepper } from "./DiyaJourneyStepper";
import { useDiya } from "@/lib/diyaStore";
import { useLiveEvent, type RunSnapshot } from "@/lib/useLiveEvent";
import { isSyntheticFallbackRisk, type RunChange, type RunOperation, type RunPlan } from "@/lib/run/types";

interface OwnerMessage {
  taskId: string;
  owner: string;
  message: string;
  whatsappUrl: string | null;
}

interface RunOptionView {
  title: string;
  tradeoffs: string[];
  rupeeImpact: number;
  report: { affectedTasks: { id: string; task: string }[]; newTimes: { taskId: string; before: string; after: string }[] };
  plan: RunPlan;
}

interface ProposalView {
  proposalId: string;
  version: number;
  changes: RunChange[];
  impact: { severity: "low" | "medium" | "high" };
  options: RunOptionView[];
  idempotencyKey: string;
}

interface ManualPlanB {
  title: string;
  summary: string;
  steps: string[];
  blockers: string[];
}

interface QueuedChange {
  id: string;
  text?: string;
  action?: string;
  taskId?: string;
}

type ScheduleFilter = "all" | "attention" | "upcoming" | "done";

interface SummaryView {
  plannedBudget: number;
  actualBudget: number;
  tasksOnTime: number;
  tasksDelayed: number;
  tasksPending: number;
  changesHandled: number;
  lessons: string[];
}

interface Props {
  eventId: string;
  organizerToken: string;
  plan: RunPlan;
  onBack: () => void;
}

function getNowNext(plan: RunPlan, now: number) {
  const pending = plan.timeline
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const active = pending.find((task) => task.status === "in_progress") ?? pending.find((task) => {
    const start = Date.parse(task.startAt);
    return start <= now && now < start + task.durationMin * 60_000;
  });
  const next = pending.find((task) => task.id !== active?.id && Date.parse(task.startAt) >= now);
  const overdue = pending.filter((task) => Date.parse(task.startAt) + task.durationMin * 60_000 < now);
  return { active, next, overdue };
}

function formatTaskTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatEventDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(date);
}

function backupActionText(operation: RunOperation, plan: RunPlan): string {
  const taskName = (id: string) => plan.timeline.find((task) => task.id === id)?.task ?? "task";
  switch (operation.type) {
    case "shift":
      return `Move ${taskName(operation.taskId)} ${operation.minutes < 0 ? "earlier" : "later"} by ${Math.abs(operation.minutes)} min`;
    case "shorten":
      return `Shorten ${taskName(operation.taskId)} by ${operation.minutes} min`;
    case "parallelize":
      return `Run ${taskName(operation.taskId)} alongside ${taskName(operation.withTaskId)}`;
    case "drop":
      return `Remove ${taskName(operation.taskId)}: ${operation.reason}`;
    case "swap_vendor":
      return `Use ${operation.vendorName} for ${taskName(operation.taskId)}`;
    case "reassign":
      return `Assign ${taskName(operation.taskId)} to ${operation.owner}`;
    case "add_task":
      return `Add ${operation.task} at ${formatTaskTime(operation.startAt)}`;
  }
}

function auditText(entry: RunSnapshot["audit"][number]): string {
  const payload = entry.payload ?? {};
  if (entry.type === "LOCKED") return "The event plan was locked with its generated contingencies.";
  if (entry.type === "APPLIED") return `Applied ${String(payload.note ?? "a verified event update")} (version ${String(payload.version ?? "")}).`;
  if (entry.type === "NOTIFY") return "WhatsApp-ready updates were prepared for affected task owners.";
  if (entry.type === "NOTIFY_FAILED") return "The change was applied; owner message drafting needs a retry.";
  if (entry.type === "CLARIFICATION") return `Asked for clarification: ${String(payload.question ?? "")}`;
  if (entry.type === "TEMPLATE_SAVED") return `Saved “${String(payload.name ?? "event")}” as a template.`;
  const note = typeof payload.note === "string" ? ` — ${payload.note}` : "";
  return `${entry.type.replaceAll("_", " ").toLowerCase()}${note}`;
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  const value = await response.json() as T & { error?: string; reasons?: string[] };
  if (!response.ok) {
    const reasons = Array.isArray(value.reasons)
      ? value.reasons
        .filter((reason): reason is string => typeof reason === "string")
        .slice(0, 3)
        .map((reason) => reason.slice(0, 240))
      : [];
    throw new Error([value.error ?? `Request failed (${response.status}).`, ...reasons].join(" "));
  }
  return value;
}

export function CommandCenter({ eventId, organizerToken, plan: initialPlan, onBack }: Props) {
  const { snapshot, isError, isLoading, refresh } = useLiveEvent(eventId, organizerToken, initialPlan);
  const version = snapshot?.version ?? 1;
  const { say, setMood } = useDiya();
  const [input, setInput] = useState("");
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [manualPlanB, setManualPlanB] = useState<ManualPlanB | null>(null);
  const [optimisticPlan, setOptimisticPlan] = useState<RunPlan | null>(null);
  const [notifications, setNotifications] = useState<OwnerMessage[]>([]);
  const [notificationRetry, setNotificationRetry] = useState<{ changes: RunChange[]; taskIds: string[]; version: number } | null>(null);
  const [queued, setQueued] = useState<QueuedChange[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SummaryView | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateSaved, setTemplateSaved] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const plan = optimisticPlan ?? snapshot?.plan ?? initialPlan;
  const queueKey = `eventmate-run-queue:${eventId}`;

  const tasks = plan.timeline;
  const completed = tasks.filter((task) => task.status === "done").length;
  const cancelled = tasks.filter((task) => task.status === "cancelled").length;
  const remaining = tasks.length - completed - cancelled;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const { active, next, overdue } = useMemo(() => getNowNext(plan, clock), [plan, clock]);
  const currentDate = new Date(clock);
  const todayKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,"0")}-${String(currentDate.getDate()).padStart(2,"0")}`;
  const eventIsToday = plan.eventDate === todayKey;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId && task.status !== "done" && task.status !== "cancelled")
    ?? active
    ?? next
    ?? tasks.find((task) => task.status !== "done" && task.status !== "cancelled");
  const selectedVendorTask = tasks.find((task) => task.id === selectedTaskId && task.vendorName && task.status !== "done" && task.status !== "cancelled")
    ?? tasks.find((task) => task.vendorName && task.status !== "done" && task.status !== "cancelled");
  const filteredTasks = tasks
    .filter((task) => {
      if (scheduleFilter === "done") return task.status === "done" || task.status === "cancelled";
      if (scheduleFilter === "attention") {
        return task.status === "in_progress" || (task.status !== "done" && task.status !== "cancelled"
          && Date.parse(task.startAt) + task.durationMin * 60_000 < clock);
      }
      if (scheduleFilter === "upcoming") return task.status !== "done" && task.status !== "cancelled";
      return true;
    })
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const costume = ["wedding", "birthday", "community", "corporate", "festival"].includes(plan.eventType)
    ? plan.eventType as "wedding" | "birthday" | "community" | "corporate" | "festival"
    : "none";

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    const readOnline = () => setIsOnline(navigator.onLine);
    readOnline();
    window.addEventListener("online", readOnline);
    window.addEventListener("offline", readOnline);
    try {
      const saved = localStorage.getItem(queueKey);
      if (saved) setQueued(JSON.parse(saved) as QueuedChange[]);
    } catch (reason) {
      console.error("Unable to restore queued event updates.", reason);
      setError("A saved offline update could not be read from this browser.");
    }
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", readOnline);
      window.removeEventListener("offline", readOnline);
    };
  }, [queueKey]);

  useEffect(() => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(queued));
    } catch (reason) {
      console.error("Unable to persist offline event updates.", reason);
      setError("This browser could not save the offline queue. Keep this page open and reconnect.");
    }
  }, [queueKey, queued]);

  useEffect(() => {
    if (proposal && proposal.version !== version) {
      setProposal(null);
      setError("The plan changed while you were reviewing. The latest version is loaded; submit your update again.");
    }
  }, [proposal, version]);

  useEffect(() => {
    if (busy) setMood("thinking");
    else if (proposal?.impact.severity === "high") setMood("worried");
  }, [busy, proposal?.impact.severity, setMood]);

  const persistQueuedChange = (change: QueuedChange) => {
    setQueued((existing) => existing.some((entry) => entry.id === change.id) ? existing : [...existing, change]);
  };

  const submitChange = useCallback(async (change: QueuedChange, removeFromQueue = false) => {
    if (!isOnline) {
      persistQueuedChange(change);
      setError("Offline — your update is saved and will sync when you're back online.");
      return;
    }
    setBusy(true);
    setError("");
    setManualPlanB(null);
    try {
      const response = await fetch(`/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({
          version,
          text: change.text,
          action: change.action,
          taskId: change.taskId,
          idempotencyKey: change.id,
        }),
      });
      const result = await readJson<ProposalView & {
        clarifyingQuestion?: string;
        completedTask?: boolean;
        manualPlanB?: ManualPlanB;
      }>(response);
      if (result.completedTask) {
        if (removeFromQueue) setQueued((existing) => existing.filter((entry) => entry.id !== change.id));
        await refresh();
        say("Task marked complete. The live schedule is up to date.", "celebrate", 2600);
        return;
      }
      if (result.clarifyingQuestion) {
        setError(result.clarifyingQuestion);
        if (removeFromQueue) setQueued((existing) => existing.filter((entry) => entry.id !== change.id));
        return;
      }
      if (result.manualPlanB) {
        setManualPlanB(result.manualPlanB);
        if (removeFromQueue) setQueued((existing) => existing.filter((entry) => entry.id !== change.id));
        return;
      }
      if (!result.proposalId || !result.options) throw new Error("No verified options were returned. Your update is still available; retry it.");
      setProposal({ ...result, idempotencyKey: crypto.randomUUID() });
      setInput("");
      if (removeFromQueue) setQueued((existing) => existing.filter((entry) => entry.id !== change.id));
    } catch (reason) {
      if (reason instanceof TypeError || !navigator.onLine) {
        setIsOnline(false);
        persistQueuedChange(change);
        setError("Offline — your update is saved and will sync when you're back online.");
      } else {
        setError(reason instanceof Error ? reason.message : "Unable to prepare this change. Your input is still here.");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [eventId, isOnline, organizerToken, refresh, say, version]);

  useEffect(() => {
    if (!isOnline || queued.length === 0 || busy || proposal) return;
    const timer = window.setTimeout(() => void submitChange(queued[0], true), 1000);
    return () => window.clearTimeout(timer);
  }, [busy, isOnline, proposal, queued, submitChange]);

  const approve = async (optionIndex: number) => {
    if (!proposal) return;
    const approvedProposal = proposal;
    const approvedOption = proposal.options[optionIndex];
    if (!approvedOption) return;
    setBusy(true);
    setError("");
    const affectedTaskIds = approvedOption.report.affectedTasks.map((task) => task.id);
    setNotificationRetry({ changes: approvedProposal.changes, taskIds: affectedTaskIds, version: approvedProposal.version + 1 });
    setOptimisticPlan(approvedOption.plan);
    setProposal(null);
    try {
      const response = await fetch(`/api/run/${eventId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({
          proposalId: approvedProposal.proposalId,
          optionIndex,
          version: approvedProposal.version,
          idempotencyKey: approvedProposal.idempotencyKey,
        }),
      });
      const result = await readJson<{ version: number; plan: RunPlan; notifications: OwnerMessage[]; notificationError: string | null }>(response);
      setNotifications(result.notifications);
      setError(result.notificationError ?? "");
      await refresh();
      setOptimisticPlan(null);
      say("The approved adjustment is in place. Everyone's next step is clear.", "celebrate", 4200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply the option. Your selected update is preserved for retry.");
      setOptimisticPlan(null);
      await refresh();
      if (!(reason instanceof Error && /plan changed|stale|refresh/i.test(reason.message))) {
        setProposal(approvedProposal);
      }
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({ version, idempotencyKey: crypto.randomUUID() }),
      });
      await readJson(response);
      await refresh();
      say("A new version has restored the previous schedule.", "celebrate", 3200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revert. Refresh and retry.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const retryNotifications = async () => {
    if (!notificationRetry) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/run/${eventId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify(notificationRetry),
      });
      const result = await readJson<{ notifications: OwnerMessage[] }>(response);
      setNotifications(result.notifications);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message drafts could not be prepared. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const generatePlanB = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/risks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${organizerToken}` },
      });
      await readJson<{ risks: RunSnapshot["risks"] }>(response);
      await refresh();
      say("Event-specific Plan B options are ready.", "greet", 2600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to generate event-specific Plan B options. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const loadSummary = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/summary`, { headers: { Authorization: `Bearer ${organizerToken}` } });
      setSummary(await readJson<SummaryView>(response));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to prepare the event summary. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({ name: templateName }),
      });
      await readJson(response);
      setTemplateSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the template. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const submitText = () => {
    if (input.trim()) void submitChange({ id: crypto.randomUUID(), text: input.trim() });
  };
  const quickAction = (action: string, taskId?: string) => void submitChange({ id: crypto.randomUUID(), action, taskId });
  const audit = [...(snapshot?.audit ?? [])].reverse();
  const ownerLinks = snapshot?.ownerLinks ?? [];
  const riskList = (snapshot?.risks ?? []).filter((risk) => !isSyntheticFallbackRisk(risk));

  return (
    <div className="min-h-screen bg-[#F4F2EB] text-[#1E332B]">
      <header className="sticky top-0 z-30 border-b border-[#E5E2D8] bg-[#FBFAF6]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-4 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#17483B] text-[#F5CA70]"><PartyPopper size={17}/></span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-tight text-[#18392E]">Eve <span className="font-medium text-[#89958D]">/ Event operations</span></p>
              <p className="text-[10px] font-semibold text-[#748178]">RUN OF SHOW · VERSION {version}</p>
            </div>
            <span className={`ml-1 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold sm:inline-flex ${isOnline && !isError ? "bg-[#E5F0E7] text-[#35644D]" : "bg-amber-100 text-amber-900"}`}>
              {isOnline && !isError ? <><Wifi size={11}/> LIVE</> : <><WifiOff size={11}/> SYNC PAUSED</>}
            </span>
          </div>
          <button onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-[#E1DED4] bg-white px-3 py-2 text-xs font-bold text-[#52645A] transition hover:border-[#B9C9BE] hover:bg-[#F7F8F4]">
            <RotateCcw size={13}/> Back to plan
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-14 pt-5 sm:px-7 sm:pt-7">
        <DiyaJourneyStepper current="RUN"/>
        {(isError || !isOnline) && <div role="status" className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          <WifiOff size={16} className="mt-0.5 shrink-0"/><span><strong>{queued.length ? `${queued.length} update${queued.length === 1 ? "" : "s"} waiting to sync.` : "Connection interrupted."}</strong> {queued.length ? "Your updates are saved on this device and will retry when you reconnect." : "Showing the last loaded event snapshot."}</span>
        </div>}
        {!isOnline && queued.length > 0 && <p className="mt-2 text-xs font-bold text-amber-950">Offline — will sync automatically.</p>}
        {error && <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-2xl border border-[#F0CAC2] bg-[#FFF5F2] px-4 py-3 text-sm text-[#8D3E34]">
          <span>{error}</span>
          {error.includes("Retry notifications") && <button onClick={() => void retryNotifications()} className="shrink-0 rounded-lg border border-[#E5B9AF] px-3 py-1.5 text-xs font-bold"><RefreshCw size={12} className="mr-1 inline"/>Retry</button>}
        </div>}
        {manualPlanB && <section role="status" className="mt-4 rounded-2xl border border-[#DCCB9D] bg-[#FFFEFA] px-4 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#92702D]"/>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-[#34483F]">{manualPlanB.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#596A60]">{manualPlanB.summary}</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-[#34483F]">
                {manualPlanB.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {manualPlanB.blockers.length > 0 && <details className="mt-3 text-[11px] text-[#66736A]">
                <summary className="cursor-pointer font-bold">View safety checks</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {manualPlanB.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              </details>}
            </div>
          </div>
        </section>}

        <section className="relative mt-6 overflow-hidden rounded-[30px] bg-[#143E33] p-5 text-white shadow-[0_20px_60px_rgba(27,65,52,0.16)] sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[#E9BF68]/10 blur-3xl"/>
          <div className="pointer-events-none absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-[#75A78C]/15 blur-3xl"/>
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.17em] text-[#F2D591]">
                  <Activity size={12}/> Event-day command
                </p>
                <h1 className="mt-4 font-display text-2xl font-extrabold capitalize tracking-tight text-white sm:text-4xl">{plan.eventType} operations</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#D2E0D7] sm:text-sm">
                  <span className="inline-flex items-center gap-1.5"><Clock size={13}/>{formatEventDate(plan.eventDate)}</span>
                  {plan.city && <span className="inline-flex items-center gap-1.5"><MapPin size={13}/>{plan.city}</span>}
                  <span className="inline-flex items-center gap-1.5"><Users size={13}/>{plan.guestCount.toLocaleString("en-IN")} guests</span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2.5">
                <div className="text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#C7D9CE]">Local time</p>
                  <p className="mt-0.5 text-sm font-extrabold tabular-nums">{new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(clock))}</p>
                </div>
                <span className={`h-2.5 w-2.5 rounded-full ${isOnline && !isError ? "bg-[#7CDD9F] shadow-[0_0_0_4px_rgba(124,221,159,0.12)]" : "bg-[#E9BF68]"}`}/>
              </div>
            </div>

            <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)] lg:items-end">
              <div className="flex items-center gap-4 sm:gap-6">
                <Diya size={78} costume={costume} moodOverride={proposal?.impact.severity === "high" ? "worried" : busy ? "thinking" : completed === tasks.length && tasks.length > 0 ? "celebrate" : "greet"}/>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#F2D591]">{active ? "Happening now" : eventIsToday && next ? "Coming up next" : overdue.length ? "Needs attention" : next ? "Runbook ready" : "Event wrap-up"}</p>
                  <h2 className="mt-1 font-display text-xl font-extrabold leading-tight text-white sm:text-2xl">
                    {active?.task ?? (eventIsToday && next ? next.task : overdue.length ? "Your schedule has overdue tasks" : next ? "Your event day is coming" : "All scheduled moments are complete")}
                  </h2>
                  {(active ?? (eventIsToday ? next : undefined)) && <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#D5E2D9]">
                    <span>{formatTaskTime((active ?? next)!.startAt)}</span><span aria-hidden>·</span><span>{(active ?? next)!.owner}</span>
                  </p>}
                  {!active && next && !eventIsToday && <p className="mt-1.5 text-xs text-[#D5E2D9]">First scheduled task · {formatTaskTime(next.startAt)}</p>}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-[#E1EAE3]">Day progress</span>
                  <span className="font-extrabold tabular-nums">{completed} of {tasks.length} complete <span className="text-[#F2D591]">· {progress}%</span></span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15">
                  <motion.div className="h-full rounded-full bg-[#EDC66E]" animate={{width:`${progress}%`}} transition={{duration:0.6,ease:"easeOut"}}/>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#C7D9CE]">Next milestone</p>
                    <p className="mt-1 truncate text-xs font-bold">{next ? `${next.task} · ${formatTaskTime(next.startAt)}` : "No upcoming task"}</p>
                  </div>
                  <button onClick={() => document.getElementById("run-schedule")?.scrollIntoView({behavior:"smooth"})} className="shrink-0 rounded-lg bg-white/10 p-2 text-[#F2D591] transition hover:bg-white/20" aria-label="Go to schedule"><ArrowRight size={15}/></button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <nav aria-label="Event operations sections" className="sticky top-[65px] z-20 mt-5 overflow-x-auto rounded-2xl border border-[#E4E1D8] bg-[#FBFAF7]/95 p-1.5 shadow-[0_8px_24px_rgba(34,58,47,0.06)] backdrop-blur">
          <div className="flex min-w-max gap-1">
            {[
              ["run-schedule","Schedule"],["change-desk","Change desk"],["plan-b","Plan B"],["team-links","Team"],["audit-trail","Activity"],["wrap-up","Wrap-up"],
            ].map(([id,label],index)=><a key={id} href={`#${id}`} className={`rounded-xl px-3.5 py-2.5 text-[11px] font-extrabold transition ${index === 0 ? "bg-[#17483B] text-white" : "text-[#637168] hover:bg-[#F0F2EC] hover:text-[#17483B]"}`}>{label}</a>)}
          </div>
        </nav>

        <section aria-label="Event operations summary" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {label:"Completed",value:completed,detail:`${progress}% of the run`,icon:CheckCircle2,tone:"green"},
            {label:"Needs attention",value:overdue.length,detail:overdue.length ? "Past schedule, not marked done" : "Nothing overdue",icon:AlertTriangle,tone:overdue.length ? "amber" : "green"},
            {label:"Still to run",value:remaining,detail:`${cancelled} cancelled`,icon:ListChecks,tone:"neutral"},
            {label:"Plan version",value:`v${version}`,detail:"Every decision is recorded",icon:ShieldCheck,tone:"gold"},
          ].map(({label,value,detail,icon:Icon,tone})=><article key={label} className="rounded-2xl border border-[#E5E2D9] bg-white p-4 shadow-[0_4px_16px_rgba(31,53,43,0.03)] sm:p-5">
            <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#66736A]">{label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone==="amber"?"bg-[#FFF3DB] text-[#9A6A22]":tone==="gold"?"bg-[#F8F0D9] text-[#96712D]":tone==="green"?"bg-[#E8F2E9] text-[#3D7555]":"bg-[#EFF1ED] text-[#5D6C62]"}`}><Icon size={15}/></span></div>
            <p className="mt-3 font-display text-2xl font-extrabold tracking-tight text-[#20372D]">{value}</p><p className="mt-1 text-[10px] font-medium text-[#66736A]">{detail}</p>
          </article>)}
        </section>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.8fr)]">
          <section id="run-schedule" className="scroll-mt-32 rounded-[26px] border border-[#E5E2D9] bg-white p-4 shadow-[0_8px_26px_rgba(31,53,43,0.035)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#765D2E]">01 · Run of show</p><h2 className="mt-1 font-display text-xl font-extrabold text-[#20372D]">Today’s schedule</h2><p className="mt-1 text-xs text-[#66736A]">Track each moment, close completed tasks, and keep owners aligned.</p></div>
              <span className="rounded-full bg-[#F0F3EE] px-3 py-1.5 text-[10px] font-extrabold text-[#51645A]">{tasks.length} moments</span>
            </div>
            <div className="mt-5 flex gap-1 overflow-x-auto border-b border-[#ECEAE3] pb-2">
              {([
                ["all",`All ${tasks.length}`],["attention",`Attention ${overdue.length}`],["upcoming",`To do ${remaining}`],["done",`Done ${completed + cancelled}`],
              ] as [ScheduleFilter,string][]).map(([filter,label])=><button key={filter} onClick={()=>setScheduleFilter(filter)} className={`shrink-0 rounded-lg px-3 py-2 text-[10px] font-extrabold transition ${scheduleFilter===filter?"bg-[#E9F1EA] text-[#24543F]":"text-[#879189] hover:bg-[#F5F6F2]"}`}>{label}</button>)}
            </div>
            <div className="mt-2 divide-y divide-[#F0EEE8]">
              {filteredTasks.map((task,index)=>{
                const isDone=task.status==="done", isCancelled=task.status==="cancelled";
                const isLate=!isDone&&!isCancelled&&task.status!=="in_progress"&&Date.parse(task.startAt)+task.durationMin*60_000<clock;
                const isLive=task.id===active?.id;
                return <article key={task.id} className={`group relative flex gap-3 py-4 sm:gap-4 ${isLive?"rounded-2xl bg-[#F2F7F1] px-3 sm:px-4":""}`}>
                  <div className="flex w-[62px] shrink-0 flex-col items-center">
                    <span className={`text-xs font-extrabold tabular-nums ${isLive?"text-[#24543F]":"text-[#607167]"}`}>{formatTaskTime(task.startAt)}</span>
                    <span className={`mt-2 flex h-7 w-7 items-center justify-center rounded-full border ${isDone?"border-[#43865B] bg-[#43865B] text-white":isCancelled?"border-[#DDDAD0] bg-[#F0EFEA] text-[#8B928B]":isLate?"border-[#D9A349] bg-[#FFF5E3] text-[#9A6A22]":isLive?"border-[#43865B] bg-white text-[#43865B]":"border-[#DBDED6] bg-white text-[#9AA39B]"}`}>
                      {isDone?<Check size={13}/>:isCancelled?<span className="text-[10px]">—</span>:isLive?<span className="h-2 w-2 rounded-full bg-[#43865B]"/>:isLate?<AlertTriangle size={13}/>:<Circle size={12}/>}
                    </span>
                    {index<filteredTasks.length-1&&<span className="mt-1 min-h-3 w-px flex-1 bg-[#E7E8E1]"/>}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className={`text-sm font-extrabold ${isDone||isCancelled?"text-[#879189] line-through decoration-[#B6BDB6]":"text-[#283D33]"}`}>{task.task}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${isDone?"bg-[#E7F2E8] text-[#3F7551]":isCancelled?"bg-[#F0F0ED] text-[#7E8880]":isLate?"bg-[#FFF1D8] text-[#946522]":isLive?"bg-[#E7F2E8] text-[#3F7551]":"bg-[#F1F2EF] text-[#68766D]"}`}>
                        {isDone?"Done":isCancelled?"Cancelled":isLate?"Overdue":isLive?"In progress":task.status==="in_progress"?"In progress":"Scheduled"}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#66736A]">
                      <span>{task.owner || "Unassigned"}</span>{task.vendorName&&<><span>·</span><span>{task.vendorName}</span></>}
                      <span>·</span><span>{task.durationMin} min</span>
                    </p>
                  </div>
                  {!isDone&&!isCancelled&&<div className="flex shrink-0 items-center gap-1 self-center">
                    <button disabled={busy||!isOnline} onClick={()=>void quickAction("delay-15",task.id)} aria-label={`Delay ${task.task} by 15 minutes`} title="Request +15 min" className="rounded-lg border border-[#E7E5DD] px-2 py-2 text-[9px] font-extrabold text-[#68766D] transition hover:border-[#C5D5C8] hover:bg-[#F3F7F2] disabled:opacity-40">+15</button>
                    <button disabled={busy||!isOnline} onClick={()=>void quickAction("task-done",task.id)} aria-label={`Mark ${task.task} complete`} title="Mark complete" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCE7DC] bg-[#F3F8F2] text-[#3F7551] transition hover:bg-[#E3F0E2] disabled:opacity-40"><Check size={14}/></button>
                  </div>}
                </article>;
              })}
              {filteredTasks.length===0&&<div className="py-10 text-center"><CheckCircle2 size={24} className="mx-auto text-[#69A174]"/><p className="mt-2 text-sm font-bold text-[#40564A]">Nothing in this view</p><p className="mt-1 text-xs text-[#66736A]">Try another schedule filter.</p></div>}
            </div>
          </section>

          <div className="space-y-5">
            <section id="change-desk" className="scroll-mt-32 rounded-[26px] border border-[#E5E2D9] bg-white p-4 shadow-[0_8px_26px_rgba(31,53,43,0.035)] sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F7F0DA] text-[#92702D]"><Sparkles size={16}/></span>
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#765D2E]">02 · Change desk</p><h2 className="mt-1 font-display text-lg font-extrabold text-[#20372D]">Something changed?</h2><p className="mt-1 text-[11px] leading-relaxed text-[#66736A]">Tell Eve in plain English. Review the impact before approving any plan change.</p></div>
              </div>
              <label htmlFor="run-change-input" className="sr-only">Describe what changed</label>
              <textarea id="run-change-input" value={input} onChange={(event)=>setInput(event.target.value)} maxLength={1200} rows={3}
                placeholder="Caterer is 40 minutes late and 30 more guests are coming…"
                className="mt-4 min-h-[92px] w-full resize-y rounded-2xl border border-[#E1DED4] bg-[#FCFBF8] px-3.5 py-3 text-sm text-[#263B32] outline-none transition placeholder:text-[#66736A] focus:border-[#B99243] focus:ring-2 focus:ring-[#B99243]/15"/>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-[#66736A]">{input.length}/1200 · One or more updates are okay</span>
                <button disabled={busy||!input.trim()} onClick={submitText} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#17483B] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#10392E] disabled:cursor-not-allowed disabled:opacity-45">
                  {busy?<><RefreshCw size={13} className="animate-spin"/>Analyzing</>:<>Review change <ArrowRight size={13}/></>}
                </button>
              </div>
              <div className="mt-4 border-t border-[#EEECE5] pt-4">
                <div className="flex items-center justify-between gap-2"><p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#66736A]">Quick actions</p>{selectedTask&&<span className="max-w-[65%] truncate text-[9px] font-semibold text-[#68766D]">For: {selectedTask.task}</span>}</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button disabled={!selectedTask||busy} onClick={()=>selectedTask&&quickAction("delay-15",selectedTask.id)} className="rounded-xl border border-[#E7E5DD] px-3 py-2.5 text-[10px] font-extrabold text-[#40564A] transition hover:border-[#BDCEBF] hover:bg-[#F4F7F2] disabled:opacity-40">Delay +15 min</button>
                  <button disabled={!selectedTask||busy} onClick={()=>selectedTask&&quickAction("delay-30",selectedTask.id)} className="rounded-xl border border-[#E7E5DD] px-3 py-2.5 text-[10px] font-extrabold text-[#40564A] transition hover:border-[#BDCEBF] hover:bg-[#F4F7F2] disabled:opacity-40">Delay +30 min</button>
                  <button disabled={busy} onClick={()=>quickAction("more-guests")} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E7E5DD] px-3 py-2.5 text-[10px] font-extrabold text-[#40564A] transition hover:border-[#BDCEBF] hover:bg-[#F4F7F2] disabled:opacity-40"><Users size={12}/>More guests</button>
                  <button disabled={busy} onClick={()=>quickAction("rain")} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E7E5DD] px-3 py-2.5 text-[10px] font-extrabold text-[#40564A] transition hover:border-[#BDCEBF] hover:bg-[#F4F7F2] disabled:opacity-40"><CloudRain size={12}/>Rain</button>
                  <button disabled={busy} onClick={()=>quickAction("venue-issue")} className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E7E5DD] px-3 py-2.5 text-[10px] font-extrabold text-[#40564A] transition hover:border-[#BDCEBF] hover:bg-[#F4F7F2] disabled:opacity-40"><MapPin size={12}/>Venue issue</button>
                </div>
                {tasks.some((task)=>task.vendorName)&&<div className="mt-2 flex gap-2">
                  <select aria-label="Choose a vendor task" value={selectedVendorTask?.id??""} onChange={(event)=>setSelectedTaskId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-[#E7E5DD] bg-white px-2.5 py-2 text-[10px] text-[#52645A]">
                    {tasks.filter((task)=>task.vendorName&&task.status!=="done"&&task.status!=="cancelled").map((task)=><option key={task.id} value={task.id}>{task.vendorName} · {task.task}</option>)}
                  </select>
                  <button disabled={busy||!selectedVendorTask} onClick={()=>selectedVendorTask&&quickAction("vendor-cancelled",selectedVendorTask.id)} className="rounded-xl border border-[#E7E5DD] px-3 py-2 text-[10px] font-extrabold text-[#6B5540] hover:bg-[#FFF7EB] disabled:opacity-40">Vendor cancelled</button>
                </div>}
              </div>
            </section>

            <section id="plan-b" className="scroll-mt-32 rounded-[26px] border border-[#E5E2D9] bg-white p-4 shadow-[0_8px_26px_rgba(31,53,43,0.035)] sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#765D2E]">03 · Event-specific contingencies</p><h2 className="mt-1 font-display text-lg font-extrabold text-[#20372D]">Plan B</h2></div>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F7F0DA] text-[#92702D]"><ShieldCheck size={16}/></span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#66736A]">Contingencies are generated from this event’s actual tasks and constraints. Vendor availability is not assumed.</p>
              <div className="mt-3 space-y-2">
                {riskList.slice(0,4).map((risk)=><article key={risk.id??risk.title} className="rounded-xl border border-[#EFEEE8] bg-[#FBFAF7] p-3">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-extrabold text-[#34483F]">{risk.title}</p><p className="mt-1 text-[9px] font-semibold capitalize text-[#849087]">{risk.triggerType.replaceAll("_"," ").toLowerCase()} · {risk.likelihood} likelihood</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-extrabold uppercase ${risk.status==="triggered"?"bg-[#FFF0D6] text-[#936421]":"bg-[#E9F2E9] text-[#3E7250]"}`}>{risk.status??"ready"}</span></div>
                  {risk.backupAction.length>0&&<p className="mt-2 border-t border-[#EAE8E0] pt-2 text-[9px] font-semibold leading-relaxed text-[#596A60]">Prepared response · {risk.backupAction.map((operation)=>backupActionText(operation,plan)).join(" · ")}</p>}
                </article>)}
                {riskList.length===0&&<div className="rounded-xl bg-[#FBFAF7] p-3">
                  <p className="text-[10px] text-[#66736A]">{isLoading?"Loading event contingencies…":"No event-specific contingencies are saved for this event yet."}</p>
                  {!isLoading&&<button disabled={busy} onClick={()=>void generatePlanB()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#17483B] px-3 py-2 text-[10px] font-extrabold text-white transition hover:bg-[#10392E] disabled:cursor-not-allowed disabled:opacity-50">
                    {busy?<><RefreshCw size={12} className="animate-spin"/>Generating from this plan…</>:<>Generate real Plan B<Sparkles size={12}/></>}
                  </button>}
                </div>}
              </div>
            </section>

            <section id="team-links" className="scroll-mt-32 rounded-[26px] border border-[#E5E2D9] bg-white p-4 shadow-[0_8px_26px_rgba(31,53,43,0.035)] sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#765D2E]">04 · Team coordination</p><h2 className="mt-1 font-display text-lg font-extrabold text-[#20372D]">Owner links</h2></div>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF3EA] text-[#477153]"><Users size={16}/></span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#66736A]">Share a private task-only link. Owners can check their assignments and report progress.</p>
              <div className="mt-3 space-y-2">
                {ownerLinks.map((link)=>{
                  const taskLabels=tasks.filter((task)=>link.task_ids.includes(task.id)).map((task)=>task.task);
                  const url=`${window.location.origin}/t/${link.token}`;
                  return <div key={link.token} className="flex items-center gap-2 rounded-xl border border-[#EFEEE8] bg-[#FBFAF7] p-2.5">
                    <div className="min-w-0 flex-1"><p className="text-[9px] font-extrabold uppercase tracking-wide text-[#849087]">{taskLabels.length} assigned task{taskLabels.length===1?"":"s"}</p><p className="mt-0.5 truncate text-[10px] font-semibold text-[#52645A]">{taskLabels.join(", ")||"No current tasks"}</p></div>
                    <button onClick={()=>navigator.clipboard.writeText(url).then(()=>say("Private owner link copied.", "greet", 1800)).catch(()=>setError("Clipboard access is unavailable in this browser."))} aria-label="Copy owner link" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E2E0D7] bg-white text-[#5B6D61] transition hover:border-[#BACDBE] hover:text-[#24543F]"><Copy size={13}/></button>
                  </div>;
                })}
                {ownerLinks.length===0&&<p className="rounded-xl bg-[#FBFAF7] p-3 text-[10px] text-[#849087]">No owner links have been created for this event yet.</p>}
              </div>
            </section>
          </div>
        </div>

        <AnimatePresence>
          {proposal&&<motion.section id="change-review" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="mt-5 scroll-mt-32 rounded-[26px] border border-[#DCCB9D] bg-[#FFFEFA] p-4 shadow-[0_12px_36px_rgba(120,94,41,0.09)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#765D2E]">05 · Impact review · {proposal.impact.severity} impact</p><h2 className="mt-1 font-display text-xl font-extrabold text-[#20372D]">Choose how to handle this change</h2><p className="mt-1 text-xs text-[#66736A]">Nothing is changed until you approve a verified option.</p></div>
              <button onClick={()=>setProposal(null)} className="rounded-xl border border-[#E5E1D5] px-3 py-2 text-[10px] font-extrabold text-[#647168] hover:bg-[#F5F3EC]">Reject all</button>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {proposal.options.map((option,index)=>{
                const beforeTasks=new Map(plan.timeline.map((task)=>[task.id,task]));
                return <article key={`${option.title}-${index}`} className={`rounded-2xl border bg-white p-4 sm:p-5 ${index===0?"border-[#BFD0BF] shadow-[0_6px_20px_rgba(45,90,58,0.07)]":"border-[#E8E5DC]"}`}>
                  <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#8A948C]">Option {index+1}{index===0?" · Recommended":""}</p><h3 className="mt-1 text-sm font-extrabold text-[#283D33]">{option.title}</h3></div><span className="rounded-full bg-[#E8F2E9] px-2.5 py-1 text-[9px] font-extrabold text-[#3F7551]"><CheckCircle2 size={10} className="mr-1 inline"/>Verified</span></div>
                  <p className={`mt-3 text-sm font-extrabold ${option.rupeeImpact>0?"text-[#A24C3D]":"text-[#315C4C]"}`}>{option.rupeeImpact>0?"+":option.rupeeImpact<0?"−":"±"}₹{Math.abs(option.rupeeImpact).toLocaleString("en-IN")} <span className="text-[10px] font-semibold text-[#66736A]">{option.rupeeImpact<0?"estimated savings":"estimated budget impact"}</span></p>
                  <div className="mt-3 rounded-xl bg-[#F7F7F2] p-3">
                    <p className="text-[9px] font-extrabold uppercase tracking-wide text-[#66736A]">Schedule impact</p>
                    <div className="mt-2 space-y-2">
                      {option.report.newTimes.slice(0,4).map((change)=>{
                        const task=beforeTasks.get(change.taskId);
                        const updated=option.plan.timeline.find((entry)=>entry.id===change.taskId);
                        return <p key={change.taskId} className="flex items-center justify-between gap-2 text-[10px]"><span className="min-w-0 truncate font-semibold text-[#52645A]">{task?.task}</span><span className="shrink-0 tabular-nums text-[#6D7B71]">{formatTaskTime(change.before)} <ArrowRight size={10} className="mx-1 inline"/> <strong className="text-[#315C4C]">{updated?formatTaskTime(updated.startAt):formatTaskTime(change.after)}</strong></span></p>;
                      })}
                      {option.report.newTimes.length===0&&option.report.affectedTasks.slice(0,3).map((task)=><p key={task.id} className="text-[10px] font-semibold text-[#52645A]">Affected · {task.task}</p>)}
                      {option.report.affectedTasks.length===0&&<p className="text-[10px] text-[#66736A]">No other tasks move.</p>}
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-[10px] leading-relaxed text-[#627168]">{option.tradeoffs.map((tradeoff)=><li key={tradeoff} className="flex gap-2"><span className="text-[#765D2E]">•</span><span>{tradeoff}</span></li>)}</ul>
                  <button disabled={busy} onClick={()=>void approve(index)} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-extrabold transition disabled:opacity-50 ${index===0?"bg-[#17483B] text-white hover:bg-[#10392E]":"border border-[#DCE3D9] bg-[#F7FAF6] text-[#315C4C] hover:bg-[#EDF4EB]"}`}>Approve option {index+1}<ArrowRight size={13}/></button>
                </article>;
              })}
            </div>
          </motion.section>}
        </AnimatePresence>

        {notifications.length>0&&<section className="mt-5 rounded-[26px] border border-[#CFE0D0] bg-[#F3F8F1] p-4 sm:p-6">
          <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E1EFDF] text-[#3F7551]"><CheckCircle2 size={17}/></span><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#54775A]">06 · Applied · owner follow-up</p><h2 className="mt-1 font-display text-lg font-extrabold text-[#20372D]">Your plan is updated. Keep the team in sync.</h2><p className="mt-1 text-[10px] text-[#728273]">Messages are drafts only. Copy or open WhatsApp when you are ready; nothing is sent automatically.</p></div></div>
          <div className="mt-4 grid gap-2 lg:grid-cols-2">{notifications.map((notice)=><article key={notice.taskId} className="rounded-2xl border border-[#E1E9DD] bg-white p-3.5">
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-[#849087]">{notice.owner}</p><p className="mt-1 text-xs leading-relaxed text-[#40564A]">{notice.message}</p>
            <div className="mt-3 flex gap-2"><button onClick={()=>navigator.clipboard.writeText(notice.message).then(()=>say("Message copied for you.","greet",1800)).catch(()=>setError("Clipboard access is unavailable in this browser."))} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E6DE] px-3 py-2 text-[10px] font-extrabold text-[#52645A]"><Copy size={12}/>Copy</button>{notice.whatsappUrl&&<a target="_blank" rel="noreferrer" href={notice.whatsappUrl} className="rounded-lg bg-[#E6F2E5] px-3 py-2 text-[10px] font-extrabold text-[#315C4C]">Open in WhatsApp</a>}</div>
          </article>)}</div>
        </section>}

        <section id="audit-trail" className="mt-5 scroll-mt-32 rounded-[26px] border border-[#E5E2D9] bg-white p-4 shadow-[0_8px_26px_rgba(31,53,43,0.035)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#765D2E]">07 · Decisions and accountability</p><h2 className="mt-1 font-display text-xl font-extrabold text-[#20372D]">Event activity</h2><p className="mt-1 text-xs text-[#66736A]">A permanent timeline of updates, approvals, and owner coordination.</p></div>
            {version>1&&<button disabled={busy} onClick={()=>void revert()} className="inline-flex items-center gap-2 rounded-xl border border-[#E2E0D7] px-3 py-2.5 text-[10px] font-extrabold text-[#52645A] transition hover:bg-[#F7F6F1] disabled:opacity-50"><RotateCcw size={12}/>Revert to previous version</button>}
          </div>
          <ol className="mt-5 space-y-0">
            {audit.slice(-8).reverse().map((entry,index)=><li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
              <div className="flex w-7 shrink-0 flex-col items-center"><span className={`z-10 flex h-7 w-7 items-center justify-center rounded-full ${index===0?"bg-[#E8F2E9] text-[#3F7551]":"bg-[#F1F2ED] text-[#77847A]"}`}>{entry.type==="APPLIED"?<Check size={13}/>:entry.type==="CLARIFICATION"?<Sparkles size={12}/>:<Activity size={12}/>}</span>{index<audit.slice(-8).length-1&&<span className="mt-1 w-px flex-1 bg-[#E8EAE3]"/>}</div>
              <div className="min-w-0 flex-1 rounded-xl bg-[#FBFAF7] px-3.5 py-3"><p className="text-xs font-bold leading-relaxed text-[#34483F]">{auditText(entry)}</p><p className="mt-1 text-[9px] font-medium text-[#66736A]">{new Date(entry.created_at).toLocaleString()} · {entry.actor}</p></div>
            </li>)}
            {audit.length===0&&<li className="rounded-xl bg-[#FBFAF7] p-4 text-xs text-[#849087]">Your event decisions will appear here as the team reports updates.</li>}
          </ol>
        </section>

        {(completed+cancelled===tasks.length||summary)&&<section id="wrap-up" className="mt-5 scroll-mt-32 rounded-[26px] border border-[#CFE0D0] bg-gradient-to-br from-[#F4F8F1] to-white p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#54775A]">08 · Close the loop</p><h2 className="mt-1 font-display text-xl font-extrabold text-[#20372D]">Event wrap-up</h2><p className="mt-1 text-xs text-[#728273]">Capture outcomes and turn what worked into your next event’s starting point.</p></div><button disabled={busy} onClick={()=>void loadSummary()} className="inline-flex items-center gap-2 rounded-xl bg-[#17483B] px-4 py-2.5 text-xs font-extrabold text-white hover:bg-[#10392E] disabled:opacity-50">{busy?<RefreshCw size={13} className="animate-spin"/>:<Sparkles size={13}/>}Generate event recap</button></div>
          {summary&&<div className="mt-4 grid gap-3 sm:grid-cols-2">
            <article className="rounded-2xl border border-[#E5E9DF] bg-white p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-[#829087]">Budget closeout</p><p className="mt-2 text-xs text-[#52645A]">Planned <strong className="text-[#263B32]">₹{summary.plannedBudget.toLocaleString("en-IN")}</strong></p><p className="mt-1 text-xs text-[#52645A]">Actual <strong className="text-[#263B32]">₹{summary.actualBudget.toLocaleString("en-IN")}</strong></p></article>
            <article className="rounded-2xl border border-[#E5E9DF] bg-white p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-[#829087]">Execution</p><p className="mt-2 text-xs text-[#52645A]">On time <strong>{summary.tasksOnTime}</strong> · Delayed <strong>{summary.tasksDelayed}</strong> · Pending <strong>{summary.tasksPending}</strong></p><p className="mt-1 text-xs text-[#52645A]">Changes handled <strong>{summary.changesHandled}</strong></p></article>
            <article className="rounded-2xl border border-[#E5E9DF] bg-white p-4 sm:col-span-2"><p className="text-[9px] font-extrabold uppercase tracking-wide text-[#829087]">What to remember</p><ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#52645A]">{summary.lessons.map((lesson)=><li key={lesson}>• {lesson}</li>)}</ul></article>
            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row"><label htmlFor="event-template-name" className="sr-only">Name this event template</label><input id="event-template-name" value={templateName} onChange={(event)=>setTemplateName(event.target.value)} maxLength={80} placeholder="Name this event template" className="min-w-0 flex-1 rounded-xl border border-[#DCD6C8] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#A77D2B]"/><button disabled={busy||templateName.trim().length<2||templateSaved} onClick={()=>void saveTemplate()} className="rounded-xl border border-[#A77D2B]/40 bg-white px-4 py-2.5 text-xs font-extrabold text-[#765D2E] disabled:opacity-50">{templateSaved?"Template saved":"Save as template"}</button></div>
          </div>}
        </section>}

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E0D7] pt-4">
          <div><p className="text-[10px] font-bold text-[#68766D]">{isOnline&&!isError?<span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#5CA56A]"/>Live sync active</span>:"Using cached event data"}</p><p className="mt-1 text-[9px] text-[#929B94]">Refreshes every 3 seconds · Changes are versioned and auditable</p></div>
          <button onClick={()=>void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-[#E2E0D7] bg-white px-3 py-2 text-[10px] font-extrabold text-[#52645A] hover:bg-[#F7F6F1]"><RefreshCw size={12}/>Refresh now</button>
        </footer>
      </main>
    </div>
  );
}

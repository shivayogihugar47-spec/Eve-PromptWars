"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Clock, RotateCcw, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Diya } from "@/components/diya/Diya";

interface OwnerTask {
  id: string;
  task: string;
  time: string;
  startAt: string;
  durationMin: number;
  owner: string;
  status: string;
}

interface OwnerData {
  eventId: string;
  version: number;
  eventType: string;
  eventDate: string;
  tasks: OwnerTask[];
}

interface OwnerOption {
  title: string;
  tradeoffs: string[];
  rupeeImpact: number;
  plan: unknown;
}

interface OwnerProposal {
  proposalId: string;
  version: number;
  changes: unknown[];
  options: OwnerOption[];
  taskId: string;
  action: "delay-15" | "delay-30";
}

export default function OwnerTasksPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<OwnerData | null>(null);
  const [proposal, setProposal] = useState<OwnerProposal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/t/${encodeURIComponent(token)}`);
    const payload = await response.json() as OwnerData & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load your tasks.");
    setData(payload);
  }, [token]);

  useEffect(() => {
    refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load your tasks."));
  }, [refresh]);

  const sendAction = async (
    taskId: string,
    action: "done" | "delay-15" | "delay-30",
    approval?: { proposalId: string; optionIndex: number; idempotencyKey: string },
  ) => {
    if (!data) return;
    setBusy(taskId);
    setError("");
    try {
      const response = await fetch(`/api/t/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          taskId,
          version: approval ? proposal?.version : data.version,
          proposalId: approval?.proposalId,
          optionIndex: approval?.optionIndex,
          idempotencyKey: approval?.idempotencyKey ?? crypto.randomUUID(),
        }),
      });
      const payload = await response.json() as OwnerData & {
        error?: string;
        proposalId?: string;
        changes?: unknown[];
        options?: OwnerOption[];
      };
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(payload.error ?? "Unable to update this task.");
      }
      if (payload.proposalId && payload.options) {
        setProposal({
          proposalId: payload.proposalId,
          version: payload.version,
          changes: payload.changes ?? [],
          options: payload.options,
          taskId,
          action: action as "delay-15" | "delay-30",
        });
      } else {
        setProposal(null);
        setData((current) => current ? { ...current, version: payload.version, tasks: payload.tasks } : current);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update this task. Please retry.");
    } finally {
      setBusy("");
    }
  };

  const approveOption = (index: number) => {
    if (!proposal) return;
    void sendAction(proposal.taskId, proposal.action, {
      proposalId: proposal.proposalId,
      optionIndex: index,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <main className="min-h-screen bg-[#F5F2E9] px-4 py-8 text-[#263B32]">
      <div className="mx-auto max-w-xl">
        <header className="mb-6 flex items-center gap-4 rounded-3xl bg-[#173F35] p-5 text-white">
          <Diya size={68} moodOverride={error ? "worried" : "greet"} />
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#F0D38C]">Eve · owner link</p>
            <h1 className="mt-1 font-display text-xl font-extrabold">Your event tasks</h1>
            {data && <p className="mt-1 text-xs text-[#D8E5DC]">{data.eventType} · {data.eventDate}</p>}
          </div>
        </header>

        {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {!data && !error && <p className="rounded-2xl bg-white p-5 text-sm text-[#66736A]">Loading your tasks…</p>}
        {data && (
          <div className="space-y-3">
            {data.tasks.map((task) => (
              <motion.article key={task.id} layout className="rounded-2xl border border-[#E6E0D3] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`font-display text-sm font-extrabold ${task.status === "done" ? "text-[#66736A] line-through" : "text-[#263B32]"}`}>{task.task}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-[#66736A]"><Clock size={12} />{task.time} · {task.durationMin} min</p>
                  </div>
                  <span className="rounded-full bg-[#F4F1E8] px-2.5 py-1 text-[10px] font-bold uppercase text-[#52645A]">{task.status}</span>
                </div>
                {task.status !== "done" && task.status !== "cancelled" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={busy === task.id} onClick={() => void sendAction(task.id, "done")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#173F35] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                      <Check size={13} /> Mark done
                    </button>
                    <button disabled={Boolean(busy)} onClick={() => void sendAction(task.id, "delay-15")}
                      className="rounded-xl border border-[#DCD6C8] px-3 py-2 text-xs font-bold text-[#52645A] disabled:opacity-50">Delay +15</button>
                    <button disabled={Boolean(busy)} onClick={() => void sendAction(task.id, "delay-30")}
                      className="rounded-xl border border-[#DCD6C8] px-3 py-2 text-xs font-bold text-[#52645A] disabled:opacity-50">Delay +30</button>
                  </div>
                )}
              </motion.article>
            ))}
            {data.tasks.length === 0 && <p className="rounded-2xl bg-white p-5 text-sm text-[#66736A]">No tasks are assigned to this link.</p>}
          </div>
        )}

        {proposal && (
          <section className="mt-5 rounded-2xl border border-[#DCD6C8] bg-[#FFFEFA] p-4">
            <h2 className="flex items-center gap-2 font-display text-sm font-extrabold"><Sparkles size={15} className="text-[#A77D2B]" />Choose a verified schedule adjustment</h2>
            <div className="mt-3 space-y-2">
              {proposal.options.map((option, index) => (
                <button key={`${option.title}-${index}`} disabled={Boolean(busy)} onClick={() => approveOption(index)}
                  className="w-full rounded-xl border border-[#E6E0D3] bg-white p-3 text-left transition hover:border-[#A77D2B]/60 disabled:opacity-50">
                  <span className="block text-xs font-bold text-[#263B32]">{option.title}</span>
                  <span className="mt-1 block text-[11px] text-[#66736A]">{option.tradeoffs.join(" · ")}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setProposal(null)} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#66736A]"><RotateCcw size={12} /> Cancel</button>
          </section>
        )}
      </div>
    </main>
  );
}

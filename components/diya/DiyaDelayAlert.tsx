"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Diya } from "./Diya";
import { useDiya } from "@/lib/diyaStore";
import type { DiyaMood } from "@/lib/diyaStore";

// Worried Diya slides in from the edge when a task is delayed,
// thinks while the timeline cascades, celebrates once the fix is approved.
export function DiyaDelayAlert({
  task,
  minutes,
  onResolved,
}: {
  task: string;
  minutes: number;
  onResolved: () => void;
}) {
  const [phase, setPhase] = useState<"worried" | "thinking" | "celebrate">("worried");
  const { say } = useDiya();

  useEffect(() => {
    say(`${task} is late! Rescheduling…`, "worried", 2600);
    const t = setTimeout(() => setPhase("thinking"), 1800);
    return () => clearTimeout(t);
  }, [say, task]);

  useEffect(() => {
    if (phase !== "thinking") return;
    const t = setTimeout(() => setPhase("celebrate"), 2400); // auto-approve fallback
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "celebrate") return;
    say("Crisis averted — timeline fixed!", "celebrate", 2600);
    const t = setTimeout(onResolved, 2000);
    return () => clearTimeout(t);
  }, [phase, say, onResolved]);

  const mood: DiyaMood = phase;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: "-110%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "-110%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
        className="fixed left-4 bottom-6 z-[65] flex items-end gap-3 max-w-[320px]"
      >
        <div className="relative flex-shrink-0">
          {phase === "worried" && (
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-[#EF4444]"
              animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
          )}
          <Diya size={72} moodOverride={mood} />
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl rounded-bl-md px-4 py-3 shadow-xl">
          <p className="text-xs font-bold text-[#374151] leading-snug">
            {phase === "worried" && <>⚠️ {task} is late! (+{minutes} min)</>}
            {phase === "thinking" && <>🔄 Cascading the timeline…</>}
            {phase === "celebrate" && <>✅ Timeline fixed — back on schedule!</>}
          </p>
          <p className="text-[10px] text-[#66736A] mt-1">
            {phase === "worried" ? "Diya is on it"
              : phase === "thinking" ? "Shifting dependent tasks"
              : "Nice save!"}
          </p>
          {phase === "thinking" && (
            <button
              onClick={() => setPhase("celebrate")}
              className="mt-2 text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#EEF2FF] text-[#6366F1]"
            >
              Approve fix
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

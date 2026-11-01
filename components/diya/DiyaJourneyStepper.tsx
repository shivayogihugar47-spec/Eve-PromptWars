"use client";

import { motion } from "framer-motion";
import { Diya } from "./Diya";
import { Check } from "lucide-react";

const STAGES = ["ASK", "PLAN", "RUN"] as const;
type Stage = (typeof STAGES)[number];

interface Props {
  current: Stage;
  compact?: boolean;
}

export function DiyaJourneyStepper({ current, compact = false }: Props) {
  const idx = STAGES.indexOf(current);

  return (
    <div className={`relative flex items-center gap-0 w-full max-w-xs mx-auto ${compact?"py-1":"py-3"}`}>
      {STAGES.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            {/* Stage circle */}
            <motion.div
              className={`relative ${compact?"h-8 w-8":"h-9 w-9"} rounded-full flex items-center justify-center z-10 border-2 font-bold text-xs flex-shrink-0 ${
                done   ? "bg-[#214E43] border-[#214E43] text-white"
                : active ? "bg-white border-[#214E43] text-[#214E43] shadow-[0_0_0_4px_rgba(33,78,67,0.14)]"
                :          "bg-white border-[#DADDD2] text-[#A7ADA4]"
              }`}
              animate={active ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              {done ? <Check size={14} strokeWidth={3} /> : s[0]}
            </motion.div>

            {/* Connector line */}
            {i < STAGES.length - 1 && (
              <div className="relative flex-1 h-1 mx-1 bg-[#F3F4F6] rounded-full overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#214E43] to-[#719879] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: i < idx ? "100%" : "0%" }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
                {/* Golden trail sparks */}
                {i < idx && (
                  <motion.div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#E7BD64]"
                    animate={{ x: ["0%", "100%"], opacity: [1, 0] }}
                    transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Walking Diya positioned over current stage */}
      {!compact&&(
        <motion.div
          className="absolute -top-7 pointer-events-none"
          animate={{ left: `${(idx / (STAGES.length - 1)) * 85 + 2}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        >
          <Diya size={36} moodOverride="greet" />
        </motion.div>
      )}

      {/* Stage labels */}
      <div className={`absolute w-full flex justify-between px-1 ${compact?"-bottom-4":"-bottom-5"}`}>
        {STAGES.map((s, i) => (
          <span key={s} className={`text-[10px] font-bold ${i <= idx ? "text-[#214E43]" : "text-[#A7ADA4]"}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

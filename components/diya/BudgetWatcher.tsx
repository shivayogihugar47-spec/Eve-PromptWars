"use client";

import { motion } from "framer-motion";
import { Diya } from "./Diya";

const fmtINR = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}K` : `₹${n}`;

// Budget donut + Diya reacting live to spend.
export function BudgetWatcher({ budget, spent }: { budget: number; spent: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const over = spent > budget;
  const mood = over ? "worried" : "celebrate";
  const color = over ? "#EF4444" : "#10B981";
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex items-center gap-4">
      {/* Donut */}
      <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
        <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
          <circle cx="44" cy="44" r={R} fill="none" stroke="#F3F4F6" strokeWidth="9" />
          <motion.circle
            cx="44" cy="44" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C - (pct / 100) * C }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-extrabold" style={{ color }}>{Math.round(pct)}%</span>
          <span className="text-[9px] font-semibold text-[#66736A]">used</span>
        </div>
      </div>

      {/* Live reaction */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="relative flex-shrink-0">
          {over && (
            <motion.span
              className="absolute inset-0 rounded-full border-2"
              style={{ borderColor: "#EF4444" }}
              animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
          )}
          {/* Coin sparkles when under budget */}
          {!over && (
            <>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="absolute text-sm pointer-events-none"
                  style={{ left: 6 + i * 14, top: 4 }}
                  animate={{ y: [0, -18, 0], opacity: [0, 1, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.4 }}
                >
                  🪙
                </motion.span>
              ))}
            </>
          )}
          <Diya size={56} moodOverride={mood} />
        </div>
        <motion.div
          key={mood}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          className="min-w-0"
        >
          <p className="text-xs font-bold" style={{ color }}>{over ? "Over budget" : "On track"}</p>
          <p className="text-[11px] text-[#6B7280] leading-snug mt-0.5">
            {over ? "Shall we trim the decor?" : "Nicely under budget — treat yourself!"}
          </p>
          <p className="text-[10px] text-[#C4C4C4] mt-0.5">
            {fmtINR(spent)} of {fmtINR(budget)}
          </p>
        </motion.div>
      </div>
    </div>
  );
}

"use client";

import { motion } from "framer-motion";
import { Diya } from "./Diya";

// Skeleton loader with Diya + a short, funny line.
export function DiyaSkeleton({ label = "Fetching the good stuff…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <motion.div
        animate={{ rotate: [0, 4, -4, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Diya size={84} moodOverride="thinking" />
      </motion.div>
      <p className="text-sm font-semibold text-[#66736A] italic">{label}</p>
      <div className="w-full max-w-sm space-y-2.5">
        {[100, 82, 64].map((w, i) => (
          <div key={i} className="h-3 rounded-full shimmer" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

"use client";

import { motion } from "framer-motion";
import type { QuickOption } from "@/app/api/chat/route";

// Quick-reply chips that "pop out" of Diya with a spring animation.
export function DiyaMessageChips({
  options,
  onSelect,
  color = "#6366F1",
  className = "",
}: {
  options: QuickOption[];
  onSelect: (value: string, label: string) => void;
  color?: string;
  className?: string;
}) {
  if (!options?.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 justify-center ${className}`}>
      {options.map((opt, i) => (
        <motion.button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value, opt.label)}
          initial={{ opacity: 0, scale: 0.4, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 16, delay: i * 0.055 }}
          whileHover={{ y: -3, scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          className="px-3.5 py-2 rounded-full text-xs font-bold bg-white border shadow-sm transition-colors"
          style={{ borderColor: `${color}44`, color }}
        >
          {opt.label}
        </motion.button>
      ))}
    </div>
  );
}

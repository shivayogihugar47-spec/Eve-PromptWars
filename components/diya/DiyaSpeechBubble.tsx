"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useDiya } from "@/lib/diyaStore";

interface Props {
  side?: "right" | "left" | "top";
  className?: string;
}

export function DiyaSpeechBubble({ side = "right", className = "" }: Props) {
  const { speech, speechVisible } = useDiya();

  const tailClass =
    side === "right"
      ? "absolute top-1/2 -left-2 -translate-y-1/2 w-3 h-3 bg-white border-l border-b border-[#E5E7EB] rotate-45"
      : side === "left"
      ? "absolute top-1/2 -right-2 -translate-y-1/2 w-3 h-3 bg-white border-r border-t border-[#E5E7EB] rotate-45"
      : "absolute -bottom-2 left-5 w-3 h-3 bg-white border-r border-b border-[#E5E7EB] rotate-45";

  return (
    <AnimatePresence>
      {speechVisible && speech && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: side === "top" ? 6 : 0, x: side === "right" ? -6 : 6 }}
          animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, scale: 0.88 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className={`relative bg-white border border-[#E5E7EB] rounded-2xl px-3.5 py-2.5 shadow-lg max-w-[200px] z-50 ${className}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <TypewriterText text={speech} />
          <div className={tailClass} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TypewriterText({ text }: { text: string }) {
  return (
    <motion.p
      key={text}
      className="text-xs font-semibold text-[#374151] leading-relaxed"
    >
      {text.split("").map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.022, duration: 0 }}
        >
          {char}
        </motion.span>
      ))}
    </motion.p>
  );
}

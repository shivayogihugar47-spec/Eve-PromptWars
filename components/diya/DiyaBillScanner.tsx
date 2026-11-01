"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Diya } from "./Diya";

// Bill-scanner modal: thinking Diya "holds" an animated scan line.
export function DiyaBillScanner({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    const t = setTimeout(() => setDone(true), 2600);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.9, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 relative"
          >
            <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-[#66736A] hover:text-[#374151]">
              <X size={16} />
            </button>

            <div className="flex items-center gap-4">
              <Diya size={84} moodOverride={done ? "celebrate" : "thinking"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-[#111827]">
                  {done ? "Got it!" : "Scanning…"}
                </p>
                <p className="text-xs text-[#66736A] mt-0.5">
                  {done ? "Read the bill in one go." : "Hold steady, I'm reading the bill."}
                </p>
              </div>
            </div>

            {/* The "scanned bill" with a moving scan line */}
            <div className="relative mt-5 h-24 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] overflow-hidden">
              <div className="p-3 space-y-1.5">
                {[70, 45, 88, 55].map((w, i) => (
                  <div key={i} className="h-2 rounded-full bg-[#E5E7EB]" style={{ width: `${w}%` }} />
                ))}
              </div>
              {!done && (
                <motion.div
                  className="absolute left-0 right-0 h-[3px]"
                  style={{ background: "linear-gradient(90deg, transparent, #6366F1, transparent)" }}
                  animate={{ top: ["4%", "92%", "4%"] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </div>

            {done && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-center justify-between text-xs font-bold"
              >
                <span className="text-[#6B7280]">Marigold Decor · Invoice</span>
                <span className="text-[#10B981]">₹12,400</span>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

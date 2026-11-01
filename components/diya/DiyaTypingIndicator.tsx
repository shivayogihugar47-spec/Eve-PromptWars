"use client";

import { Diya } from "./Diya";
import { useWittyStatus } from "./FloatingDiya";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CalendarDays, Flower2, Sparkles, PartyPopper, Users, Presentation, Music, Trees, Utensils, Cake, type LucideIcon } from "lucide-react";

const EVENT_ICONS: Record<string, [LucideIcon, LucideIcon]> = {
  wedding: [CalendarDays, Flower2],
  birthday: [Cake, PartyPopper],
  community: [Users, Trees],
  corporate: [Presentation, Users],
  festival: [Music, Trees],
  other: [CalendarDays, Sparkles],
};

export function DiyaTypingIndicator({ active, eventType = "other" }: { active: boolean; eventType?: string }) {
  const line = useWittyStatus(active, eventType);
  const reduceMotion = useReducedMotion();
  const [FirstIcon, SecondIcon] = EVENT_ICONS[eventType] ?? EVENT_ICONS.other;
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative flex h-32 w-32 items-center justify-center">
            <motion.div
              className="absolute inset-2 rounded-full border border-dashed border-[#BFCDBF]"
              animate={reduceMotion ? undefined : { rotate: 360 }}
              transition={reduceMotion ? undefined : { duration: 28, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute left-1 top-8 flex h-8 w-8 items-center justify-center rounded-full border border-[#E7DAB6] bg-[#FFF9E8] text-[#A57C2F] shadow-sm"
              animate={reduceMotion ? undefined : { y: [0, -4, 0], rotate: [-6, 6, -6] }}
              transition={reduceMotion ? undefined : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <FirstIcon size={14} />
            </motion.div>
            <motion.div
              className="absolute right-0 top-7 flex h-8 w-8 items-center justify-center rounded-full border border-[#E7DAB6] bg-[#FFF9E8] text-[#A57C2F] shadow-sm"
              animate={reduceMotion ? undefined : { y: [0, 4, 0], rotate: [5, -5, 5] }}
              transition={reduceMotion ? undefined : { duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <SecondIcon size={15} />
            </motion.div>
            <motion.div
              className="absolute bottom-1 right-7 flex h-7 w-7 items-center justify-center rounded-full border border-[#D5E0D3] bg-[#F3F7F0] text-[#547761] shadow-sm"
              animate={reduceMotion ? undefined : { scale: [1, 1.12, 1] }}
              transition={reduceMotion ? undefined : { duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              {eventType === "corporate" ? <Utensils size={13} /> : <Sparkles size={13} />}
            </motion.div>
            <motion.div
              className="absolute inset-5 rounded-full bg-[#E9EFE4]"
              animate={reduceMotion ? undefined : { scale: [0.94, 1.04, 0.94] }}
              transition={reduceMotion ? undefined : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative z-10 drop-shadow-[0_8px_8px_rgba(47,65,48,0.12)]">
              <Diya size={82} moodOverride="thinking" />
            </div>
          </div>
          <div className="flex min-h-11 max-w-[280px] items-center gap-2.5 rounded-full border border-[#DAD7CB] bg-[#FFFEFA] px-4 py-2 shadow-[0_5px_16px_rgba(38,59,50,0.08)]">
            <Sparkles size={14} className="shrink-0 text-[#B58B38]" />
            <AnimatePresence mode="wait">
              <motion.p
                key={line}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-center text-xs font-semibold text-[#405247]"
              >
                {line}
              </motion.p>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

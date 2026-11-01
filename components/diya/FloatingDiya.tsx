"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useMotionValue, useSpring, AnimatePresence } from "framer-motion";
import { Settings, X } from "lucide-react";
import { useDiya, type MascotPref } from "@/lib/diyaStore";
import { Diya } from "./Diya";
import { DiyaSpeechBubble } from "./DiyaSpeechBubble";

// Confetti is lazily imported so it never ships in the initial bundle.
let confetti: ((opts: Record<string, unknown>) => void) | null = null;
if (typeof window !== "undefined") {
  import("canvas-confetti").then((m) => { confetti = m.default as typeof confetti; });
}

const WITTY_LINES = [
  "Consulting the aunties...",
  "Counting laddoos...",
  "Haggling with the caterer...",
  "Checking the pandit's calendar...",
  "Polishing the banana leaves...",
  "Negotiating with the DJ...",
  "Measuring the mandap...",
  "Tasting the biryani samples...",
  "Ironing the sherwani...",
  "Sourcing the best marigolds...",
];

const EVENT_WITTY_LINES: Record<string, string[]> = {
  wedding: ["Lining up the baraat...", "Checking the mandap details...", "Finding the perfect first-dance song...", "Making room for all the family photos...", "Counting the laddoos (for quality)..."],
  birthday: ["Making sure the cake gets a grand entrance...", "Picking the party playlist...", "Planning one excellent surprise...", "Saving room for extra frosting...", "Getting the birthday candles in formation..."],
  community: ["Making space for every neighbor...", "Rounding up local performers...", "Mapping an easy-to-join-in flow...", "Finding the best spot for the shared meal...", "Making sure everyone feels welcome..."],
  corporate: ["Balancing the agenda and coffee breaks...", "Checking the microphones before the big ideas...", "Making room for useful conversations...", "Lining up the breakout sessions...", "Keeping the keynote on schedule..."],
  festival: ["Mapping the crowd flow...", "Checking the stage and sound plan...", "Making room for one more food stall...", "Coordinating the opening procession...", "Planning a smooth festival run..."],
  other: WITTY_LINES,
};

export function FloatingDiya() {
  const { speechVisible, isAsleep, partyMode, mascotPref, wake, sleep, setMascotPref } = useDiya();
  const [showSettings, setShowSettings] = useState(false);
  const [size, setSize] = useState(88);
  const [hopKey, setHopKey] = useState(0);
  const sleepTimer = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Gentle "lean toward the cursor" — delayed float via spring.
  const leanX = useSpring(0, { stiffness: 40, damping: 18 });
  const leanY = useSpring(0, { stiffness: 40, damping: 18 });
  const dragging = useMotionValue(0);

  const resetSleepTimer = useCallback(() => {
    const wasAsleep = useDiya.getState().isAsleep;
    wake();
    if (wasAsleep) setHopKey((k) => k + 1); // small hop on wake
    clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(sleep, 30000);
  }, [wake, sleep]);

  useEffect(() => {
    const setSz = () => setSize(window.innerWidth < 640 ? 64 : 88);
    setSz();
    window.addEventListener("resize", setSz);
    return () => window.removeEventListener("resize", setSz);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      resetSleepTimer();
      const el = containerRef.current;
      if (!el || dragging.get()) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const clamp = (v: number) => Math.max(-14, Math.min(14, v));
      leanX.set(clamp((e.clientX - cx) * 0.06));
      leanY.set(clamp((e.clientY - cy) * 0.06));
    };
    window.addEventListener("mousemove", onMove);
    sleepTimer.current = setTimeout(sleep, 30000);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(sleepTimer.current);
    };
  }, [leanX, leanY, dragging, resetSleepTimer, sleep]);

  // Party mode → bursts of confetti.
  useEffect(() => {
    if (!partyMode || !confetti) return;
    const end = Date.now() + 3000;
    const frame = () => {
      if (Date.now() > end) return;
      confetti?.({ particleCount: 6, spread: 80, origin: { x: Math.random(), y: Math.random() * 0.6 } });
      requestAnimationFrame(frame);
    };
    frame();
  }, [partyMode]);

  return (
    <div ref={containerRef} className="landing-floating-diya fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 pointer-events-none">
      {/* Speech bubble above (typewriter) */}
      <AnimatePresence>
        {mascotPref !== "off" && speechVisible && (
          <div className="pointer-events-none">
            <DiyaSpeechBubble side="top" />
          </div>
        )}
      </AnimatePresence>

      {/* Settings panel — "Mascot: On / Reduced / Off" */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            className="pointer-events-auto bg-white border border-[#E5E7EB] rounded-2xl shadow-xl p-4 min-w-[160px]"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-[#374151]">Mascot Settings</p>
              <button onClick={() => setShowSettings(false)} className="text-[#66736A] hover:text-[#374151]">
                <X size={13} />
              </button>
            </div>
            {(["on", "reduced", "off"] as MascotPref[]).map((pref) => (
              <button
                key={pref}
                onClick={() => setMascotPref(pref)}
                className={`w-full text-left text-xs font-semibold px-3 py-1.5 rounded-xl capitalize transition-colors ${
                  mascotPref === pref
                    ? "bg-[#EEF2FF] text-[#6366F1]"
                    : "text-[#6B7280] hover:bg-[#F9FAFB]"
                }`}
              >
                {pref === "on" ? "On (full)" : pref === "reduced" ? "Reduced" : "Off"}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The companion — draggable, docked bottom-right */}
      <div className="pointer-events-auto flex items-end gap-2">
        <button
          onClick={() => setShowSettings((s) => !s)}
          aria-label="Mascot settings"
          className={`w-7 h-7 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center shadow-sm transition-all mb-2 ${
            mascotPref === "off" 
              ? "opacity-40 hover:opacity-100 hover:text-[#6366F1]" 
              : "text-[#C4C4C4] hover:text-[#6366F1]"
          }`}
        >
          <Settings size={12} />
        </button>

        <AnimatePresence>
          {mascotPref !== "off" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5, y: 20 }}
              drag
              dragMomentum={false}
              dragElastic={0.08}
              onDragStart={() => dragging.set(1)}
              onDragEnd={() => dragging.set(0)}
              style={{ x: leanX, y: leanY, touchAction: "none" }}
              className="relative cursor-grab active:cursor-grabbing"
            >
              {/* Party mode rainbow glow */}
              {partyMode && (
                <motion.div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.3, 1] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                  style={{
                    background: "conic-gradient(red, orange, yellow, green, blue, violet, red)",
                    filter: "blur(12px)",
                    borderRadius: "50%",
                  }}
                />
              )}

              <motion.div
                key={hopKey}
                animate={
                  isAsleep
                    ? { y: [0, -3, 0], rotate: [0, -3, 0] }
                    : hopKey > 0
                    ? { y: [0, -14, 0], scale: [1, 1.08, 1] }
                    : { y: [0, -5, 0] }
                }
                transition={{ duration: isAsleep ? 3 : hopKey > 0 ? 0.5 : 2.5, repeat: hopKey > 0 ? 0 : Infinity, ease: "easeInOut" }}
              >
                <Diya size={size} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Witty status lines hook (shared with DiyaTypingIndicator) ────────────────
export function useWittyStatus(active: boolean, eventType = "other"): string {
  const [line, setLine] = useState((EVENT_WITTY_LINES[eventType] ?? EVENT_WITTY_LINES.other)[0]);
  useEffect(() => {
    if (!active) return;
    const lines = EVENT_WITTY_LINES[eventType] ?? EVENT_WITTY_LINES.other;
    setLine(lines[Math.floor(Math.random() * lines.length)]);
    const id = setInterval(() => {
      setLine(lines[Math.floor(Math.random() * lines.length)]);
    }, 2200);
    return () => clearInterval(id);
  }, [active, eventType]);
  return line;
}

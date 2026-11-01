"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Diya } from "./Diya";
import { useDiya } from "@/lib/diyaStore";

interface Props {
  onLit: () => void;
}

export function LightTheLamp({ onLit }: Props) {
  const [phase, setPhase] = useState<"sleep" | "igniting" | "lit">("sleep");
  const [holdPct, setHoldPct] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setInterval>>();
  const ignitionRef = useRef(false);
  const { setMood, say, pulse } = useDiya();

  const ignite = () => {
    if (ignitionRef.current) return;
    ignitionRef.current = true;
    clearInterval(holdTimer.current);
    setHoldPct(100);
    setPhase("igniting");
    setMood("greet");                       // woken up
    say("The diya is lit — let's plan something magical!", "greet", 2200);
    setTimeout(() => {
      setPhase("lit");
      pulse();                              // celebrate burst
      setTimeout(onLit, 1200);              // animated transition into chat
    }, 1000);
  };

  // Click OR hold (600ms) lights the lamp.
  const startHold = () => {
    if (phase !== "sleep") return;
    let pct = 0;
    holdTimer.current = setInterval(() => {
      pct += 6;
      setHoldPct(pct);
      if (pct >= 100) ignite();
    }, 40);
  };
  const endHold = () => {
    clearInterval(holdTimer.current);
    if (phase !== "sleep" || ignitionRef.current) return;
    // quick tap → light too
    if (holdPct < 100) ignite();
  };

  return (
    <div className="relative flex flex-col items-center justify-center gap-6">
      {/* Warm radial glow expanding across the whole page on ignition */}
      <AnimatePresence>
        {(phase === "lit" || phase === "igniting") && (
          <motion.div
            initial={{ opacity: 0, scale: 0.25 }}
            animate={{ opacity: 1, scale: 9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            className="fixed inset-0 pointer-events-none z-40"
            style={{
              background:
                "radial-gradient(circle at center, rgba(251,191,36,0.40) 0%, rgba(245,158,11,0.14) 45%, transparent 70%)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Diya — a big sleeping lamp until lit */}
      <motion.div
        animate={
          phase === "igniting" ? { scale: [1, 1.16, 1], rotate: [0, -5, 5, 0] }
          : phase === "sleep" ? { scale: [1, 1.02, 1] }
          : { scale: [1, 1.05, 1] }
        }
        transition={{ duration: phase === "sleep" ? 4 : 1.2, repeat: phase === "lit" ? Infinity : 0, ease: "easeInOut" }}
      >
        <Diya
          size={200}
          moodOverride={phase === "sleep" ? "sleep" : phase === "igniting" ? "greet" : "celebrate"}
        />
      </motion.div>

      {/* The CTA */}
      <AnimatePresence mode="wait">
        {phase === "sleep" && (
          <motion.button
            key="cta"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={() => { clearInterval(holdTimer.current); if (!ignitionRef.current) setHoldPct(0); }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="relative overflow-hidden flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-base text-white shadow-lg shadow-amber-200/60"
            style={{ background: "linear-gradient(135deg, #F59E0B 0%, #F97316 55%, #EF4444 100%)" }}
          >
            {/* hold progress fill */}
            <motion.div
              className="absolute inset-y-0 left-0 pointer-events-none"
              style={{ background: "rgba(255,255,255,0.28)" }}
              animate={{ width: `${holdPct}%` }}
              transition={{ duration: 0.05 }}
            />
            {/* shimmer sweep */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)" }}
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="relative text-xl">🪔</span>
            <span className="relative">Light the Diya</span>
          </motion.button>
        )}
        {phase === "igniting" && (
          <motion.p
            key="igniting"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="text-sm font-bold text-[#765D2E] tracking-wide">
            Igniting the flame…
          </motion.p>
        )}
        {phase === "lit" && (
          <motion.p
            key="lit"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="text-sm font-bold text-[#765D2E] tracking-wide">
            Welcome — taking you in…
          </motion.p>
        )}
      </AnimatePresence>

      <p className="text-sm text-[#66736A] text-center max-w-xs">
        Click or hold to begin your planning journey
      </p>
    </div>
  );
}

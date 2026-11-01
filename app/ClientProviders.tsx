"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { useDiya } from "@/lib/diyaStore";

const Diya = dynamic(() => import("@/components/diya/Diya").then((module) => module.Diya), { ssr: false });

const FloatingDiya = dynamic(
  () => import("@/components/diya/FloatingDiya").then(m => m.FloatingDiya),
  { ssr: false }
);
const CursorSparks = dynamic(
  () => import("@/components/diya/CursorSparks").then(m => m.CursorSparks),
  { ssr: false }
);

// Konami code easter egg
const KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];

// Diya sprints across the whole viewport (Konami reward).
function DiyaRun({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed bottom-24 z-[70] pointer-events-none"
          initial={{ x: "-20vw" }}
          animate={{ x: "110vw" }}
          exit={{ opacity: 0 }}
          transition={{ duration: 2.6, ease: "easeInOut" }}
        >
          <motion.div animate={{ y: [0, -22, 0] }} transition={{ duration: 0.3, repeat: 9 }}>
            <Diya size={72} moodOverride="celebrate" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const { mascotPref, say, isRunning } = useDiya();

  // Greet once on first load.
  useEffect(() => {
    const t = setTimeout(() => say("Hi, I'm Diya, your Eve planner.", "greet", 4000), 1200);
    return () => clearTimeout(t);
  }, [say]);

  // Konami code → Diya runs across the screen.
  useEffect(() => {
    let seq: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      seq = [...seq.slice(-9), e.keyCode];
      if (seq.join(",") === KONAMI.join(",")) {
        useDiya.getState().triggerRun();
        say("Konami! Catch me if you can!", "celebrate", 3200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [say]);

  return (
    <MotionConfig reducedMotion="user">
      {children}
      <FloatingDiya />
      <DiyaRun active={isRunning} />
      {mascotPref === "on" && <CursorSparks />}
    </MotionConfig>
  );
}

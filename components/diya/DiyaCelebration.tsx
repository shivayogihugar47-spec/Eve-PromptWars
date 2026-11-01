"use client";

import { useEffect, useRef } from "react";

let confetti: ((opts: Record<string, unknown>) => void) | null = null;
if (typeof window !== "undefined") {
  import("canvas-confetti").then((m) => { confetti = m.default as typeof confetti; });
}

export function PlanLockedCelebration({ active }: { active: boolean }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!active || firedRef.current) return;
    firedRef.current = true;
    const timer = window.setTimeout(() => {
      confetti?.({
        particleCount: 55,
        spread: 62,
        startVelocity: 28,
        origin: { x: 0.5, y: 0.55 },
        colors: ["#F6C65B", "#D9684E", "#76A88A", "#FFFFFF"],
        disableForReducedMotion: true,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active]);

  return null;
}

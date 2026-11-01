"use client";

import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDiya, type DiyaMood } from "@/lib/diyaStore";

// ── Mood → file mapping ──────────────────────────────────────────────────────
export const DIYA_SRC: Record<DiyaMood, string> = {
  wave:      "/diya/wave_transparent.webp",
  greet:     "/diya/greet_transparent.webp",
  thinking:  "/diya/thinking_transparent.webp",
  celebrate: "/diya/celebrate_transparent.webp",
  worried:   "/diya/worried_transparent.webp",
  idle:      "/diya/wave_transparent.webp",
  sleep:     "/diya/wave_transparent.webp",
};

// ── CSS accessories by event type ────────────────────────────────────────────
export type EventCostume = "wedding" | "birthday" | "community" | "corporate" | "festival" | "none";
function CostumeAccessory({ costume, size }: { costume: EventCostume; size: number }) {
  if (costume === "none") return null;
  const accessories: Partial<Record<EventCostume, { emoji: string; style: React.CSSProperties }>> = {
    birthday:  { emoji: "🎩", style: { top: -size * 0.22, left: "50%", transform: "translateX(-50%)", fontSize: size * 0.28 } },
    wedding:   { emoji: "💐", style: { bottom: size * 0.05, right: -size * 0.1, fontSize: size * 0.22 } },
    community: { emoji: "🏮", style: { top: -size * 0.1, right: -size * 0.1, fontSize: size * 0.22 } },
    corporate: { emoji: "💼", style: { bottom: size * 0.05, left: -size * 0.1, fontSize: size * 0.22 } },
    festival:  { emoji: "✨", style: { top: -size * 0.1, left: "50%", transform: "translateX(-50%)", fontSize: size * 0.2 } },
  };
  const acc = accessories[costume];
  if (!acc) return null;
  return (
    <motion.span
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      className="absolute pointer-events-none select-none"
      style={{ position: "absolute", ...acc.style }}
    >
      {acc.emoji}
    </motion.span>
  );
}

// ── Zzz sleep indicator ──────────────────────────────────────────────────────
function ZzzBubble() {
  return (
    <div className="absolute -top-3 -right-1 flex flex-col items-center gap-0.5 pointer-events-none">
      {["z", "Z", "Z"].map((z, i) => (
        <motion.span
          key={i}
          className="font-bold text-[#9CA3AF] select-none"
          style={{ fontSize: 10 + i * 3 }}
          animate={{ y: [0, -8, 0], opacity: [0.3, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
        >
          {z}
        </motion.span>
      ))}
    </div>
  );
}

// ── Main Diya component ──────────────────────────────────────────────────────
interface DiyaProps {
  size?: number;
  costume?: EventCostume;
  moodOverride?: DiyaMood; // bypass store for isolated use
  className?: string;
}

export function Diya({ size = 120, costume = "none", moodOverride, className = "" }: DiyaProps) {
  const { mood: storeMood, isAsleep, mascotPref, handleClick } = useDiya();
  const mood = moodOverride ?? storeMood;
  const src = DIYA_SRC[mood];
  const reduceMotion = useReducedMotion();
  const prefReduced = mascotPref === "reduced" || reduceMotion;

  if (mascotPref === "off") return null;

  return (
    <motion.button
      type="button"
      aria-label={`Diya mascot, ${mood} mood`}
      className={`relative flex-shrink-0 cursor-pointer select-none border-0 bg-transparent p-0 ${className}`}
      style={{ width: size, height: size }}
      onClick={handleClick}
      whileTap={prefReduced ? undefined : { scale: 0.92 }}
    >
      {prefReduced ? (
        // Reduced motion → static first frame, no crossfade.
        <Image
          src={src}
          alt={`Diya: ${mood}`}
          width={size}
          height={size}
          className="object-contain w-full h-full drop-shadow-lg"
          unoptimized
        />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={mood}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{ width: size, height: size }}
          >
            <Image
              src={src}
              alt={`Diya: ${mood}`}
              width={size}
              height={size}
              className="object-contain w-full h-full drop-shadow-lg"
              unoptimized
            />
          </motion.div>
        </AnimatePresence>
      )}

      {isAsleep && !moodOverride && <ZzzBubble />}
      <CostumeAccessory costume={costume} size={size} />
    </motion.button>
  );
}

import { create } from "zustand";

export type DiyaMood =
  | "wave"
  | "greet"
  | "thinking"
  | "celebrate"
  | "worried"
  | "idle"
  | "sleep";
export type MascotPref = "on" | "reduced" | "off";

interface DiyaState {
  mood: DiyaMood;
  speech: string;
  speechVisible: boolean;
  isAsleep: boolean;
  partyMode: boolean;
  isRunning: boolean;
  clickCount: number;
  lastClickTime: number;
  mascotPref: MascotPref;

  setMood: (mood: DiyaMood) => void;
  say: (text: string, mood?: DiyaMood, durationMs?: number) => void;
  pulse: () => void;
  sleep: () => void;
  wake: () => void;
  triggerPartyMode: () => void;
  triggerRun: () => void;
  handleClick: () => void;
  setMascotPref: (pref: MascotPref) => void;
}

export const useDiya = create<DiyaState>((set, get) => ({
  mood: "wave",
  speech: "",
  speechVisible: false,
  isAsleep: false,
  partyMode: false,
  isRunning: false,
  clickCount: 0,
  lastClickTime: 0,
  mascotPref:
    typeof window !== "undefined"
      ? (localStorage.getItem("mascot-pref") as MascotPref) ?? "on"
      : "on",

  setMood: (mood) => set({ mood, isAsleep: false }),

  say: (text, mood, durationMs = 3500) => {
    if (mood) set({ mood, isAsleep: false });
    set({ speech: text, speechVisible: true });
    setTimeout(() => set({ speechVisible: false }), durationMs);
  },

  pulse: () => {
    const current = get().mood;
    set({ mood: "celebrate" });
    setTimeout(() => set({ mood: current }), 600);
  },

  sleep: () => set({ isAsleep: true, mood: "sleep" }),
  wake: () => {
    if (get().isAsleep)
      set({ isAsleep: false, mood: "greet", speech: "", speechVisible: false });
  },

  triggerPartyMode: () => {
    set({ partyMode: true, mood: "celebrate" });
    setTimeout(() => set({ partyMode: false, mood: "greet" }), 5000);
  },

  triggerRun: () => {
    set({ isRunning: true, mood: "celebrate" });
    setTimeout(() => set({ isRunning: false, mood: "wave" }), 3200);
  },

  handleClick: () => {
    const now = Date.now();
    const { clickCount, lastClickTime, triggerPartyMode } = get();
    const newCount = now - lastClickTime < 600 ? clickCount + 1 : 1;
    set({ clickCount: newCount, lastClickTime: now });
    if (newCount >= 5) {
      set({ clickCount: 0 });
      triggerPartyMode();
    }
  },

  setMascotPref: (pref) => {
    if (typeof window !== "undefined") localStorage.setItem("mascot-pref", pref);
    set({ mascotPref: pref });
  },
}));

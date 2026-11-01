"use client";

import { useState, type FormEvent } from "react";
import { X, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

interface Props {
  onClose: () => void;
  onAuthenticated: (user: AccountUser) => void;
}

export function AuthDialog({ onClose, onAuthenticated }: Props) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.message || "We couldn't complete that request. Please try again.");
        return;
      }

      const sessionResult = await authClient.getSession();
      if (sessionResult.error || !sessionResult.data?.user) {
        setError("Your account was created, but we couldn't start a session. Please sign in.");
        return;
      }
      const user = sessionResult.data.user;
      onAuthenticated({ id: user.id, email: user.email, name: user.name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication is temporarily unavailable. Please retry.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#16231F]/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="auth-title" className="w-full max-w-md rounded-3xl border border-[#E6E0D3] bg-[#FFFEFA] p-6 shadow-[0_24px_80px_rgba(16,30,24,0.28)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#214E43] text-[#F6C65B]"><Sparkles size={17}/></span>
            <h2 id="auth-title" className="mt-4 font-display text-2xl font-extrabold text-[#202B27]">
              {mode === "sign-up" ? "Create your account" : "Welcome back"}
            </h2>
            <p className="mt-1 text-sm text-[#68736D]">Sign in to save and revisit your event plans.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close sign-in dialog" className="rounded-lg p-2 text-[#68736D] transition hover:bg-[#F1F4EF] hover:text-[#214E43]">
            <X size={18}/>
          </button>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "sign-up" && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#34483F]">Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoComplete="name" className="h-11 w-full rounded-xl border border-[#D8D6CD] bg-white px-3 text-sm text-[#202B27] outline-none focus:border-[#A77D2B]"/>
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[#34483F]">Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="email" className="h-11 w-full rounded-xl border border-[#D8D6CD] bg-white px-3 text-sm text-[#202B27] outline-none focus:border-[#A77D2B]"/>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[#34483F]">Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className="h-11 w-full rounded-xl border border-[#D8D6CD] bg-white px-3 text-sm text-[#202B27] outline-none focus:border-[#A77D2B]"/>
            {mode === "sign-up" && <span className="mt-1 block text-[11px] text-[#66736A]">Use at least 8 characters.</span>}
          </label>
          {error && <p role="alert" className="rounded-xl border border-[#F0D3CB] bg-[#FFF5F1] px-3 py-2.5 text-xs leading-relaxed text-[#9A4938]">{error}</p>}
          <button type="submit" disabled={pending} className="flex h-11 w-full items-center justify-center rounded-xl bg-[#214E43] px-4 text-sm font-extrabold text-white transition hover:bg-[#173D34] disabled:cursor-wait disabled:opacity-60">
            {pending ? "Please wait…" : mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[#68736D]">
          {mode === "sign-up" ? "Already have an account?" : "New to Eve?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); setError(""); }} className="font-extrabold text-[#315C4C] underline-offset-2 hover:underline">
            {mode === "sign-up" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>
    </div>
  );
}

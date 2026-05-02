"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { MonogramDisc } from "./Marks";

const LOADING_STEPS = [
  "מכין את הסוכן…",
  "מקצה משאבים…",
  "מפעיל יכולות…",
  "כמעט מוכן…",
];
const STEP_INTERVAL_MS = 3500;

export function CreateBotForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = data?.error?.code as string | undefined;
        throw new Error(codeToHe(code) ?? "לא הצלחנו ליצור את הבוט");
      }
      router.refresh();
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setBusy(false);
    }
  }

  if (busy) return <CreatingPanel name={displayName.trim()} />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="block text-sm text-espresso-light mb-1.5">
          איך הסוכן שלכם ייקרא?
        </span>
        <input
          type="text"
          required
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="לדוגמה: ג׳ארוויס, שלומי, אלפרד"
          className="w-full px-4 py-3 rounded-xl border border-sand bg-white text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale"
        />
      </label>
      <button
        type="submit"
        disabled={displayName.trim().length === 0}
        className="px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition disabled:opacity-50"
      >
        יצירת סוכן
      </button>
      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function CreatingPanel({ name }: { name: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1 < LOADING_STEPS.length ? s + 1 : s));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative rounded-[20px] border border-sand-light bg-cream/50 px-8 py-10 text-center overflow-hidden">
      <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
      <div className="relative mx-auto mb-6 inline-flex">
        <span aria-hidden className="absolute inset-0 rounded-full bg-terra-pale/70 blur-[2px] animate-pulse" />
        <span className="relative">
          <MonogramDisc letter={name || "א"} size="lg" />
        </span>
      </div>
      <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-2">
        בעלייה
      </p>
      <h3 className="font-display text-2xl text-espresso mb-2 leading-tight">
        {name ? `מקים את ${name}` : "מקים את הסוכן"}
      </h3>
      <p className="text-sm text-espresso-light mb-7 italic">
        זה לוקח כדקה — אנחנו מכינים הכל ברקע.
      </p>
      <ol className="space-y-2.5 text-right max-w-xs mx-auto">
        {LOADING_STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li
              key={label}
              className={`flex items-center gap-3 text-sm transition-colors duration-500 ${
                state === "pending" ? "text-sand" : "text-espresso"
              }`}
            >
              <StepIcon state={state} />
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sage-pale text-sage">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative inline-flex h-5 w-5 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-terra-pale animate-ping" />
        <span className="relative h-2 w-2 rounded-full bg-terra" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sand">
      <span className="h-1.5 w-1.5 rounded-full bg-sand" />
    </span>
  );
}

function codeToHe(code: string | undefined): string | undefined {
  switch (code) {
    case "orchestrator_unavailable":
      return "השרת לא זמין כרגע. נסו בעוד רגע.";
    case "invalid_body":
      return "פרטים לא תקינים";
    default:
      return undefined;
  }
}

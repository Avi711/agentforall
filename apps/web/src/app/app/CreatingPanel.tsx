"use client";

import { useEffect, useState } from "react";
import { MonogramDisc } from "./Marks";

const LOADING_STEPS = [
  "מכין את הסוכן…",
  "מקצה משאבים…",
  "מפעיל יכולות…",
  "כמעט מוכן…",
];
const STEP_INTERVAL_MS = 5000;

export function CreatingPanel({ name }: { name: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1 < LOADING_STEPS.length ? s + 1 : s));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const progress = Math.min(((step + 1) / LOADING_STEPS.length) * 100, 100);

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative rounded-[28px] border border-sand-light bg-white shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] px-8 py-12 text-center overflow-hidden"
    >
      <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />

      <div className="relative mx-auto mb-7 inline-flex">
        <span aria-hidden className="absolute -inset-3 rounded-full bg-terra-pale animate-halo blur-[6px]" />
        <span aria-hidden className="absolute -inset-3">
          <RotatingArc className="text-terra animate-spin-slow" />
        </span>
        <span aria-hidden className="absolute -inset-5">
          <RotatingDots className="text-sand animate-spin-slow-reverse" />
        </span>
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
      <p className="text-sm text-espresso-light mb-8 italic">
        זה לוקח כדקה — אנחנו מכינים הכל ברקע.
      </p>

      <ol className="space-y-3 text-right max-w-xs mx-auto mb-8">
        {LOADING_STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li
              key={label}
              className={`flex items-center gap-3 text-sm transition-colors duration-500 ${
                state === "pending"
                  ? "text-sand"
                  : state === "active"
                    ? "text-espresso font-medium"
                    : "text-espresso"
              }`}
            >
              <StepIcon state={state} />
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      <div className="max-w-xs mx-auto">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-espresso-light/70 mb-2">
          <span>שלב {step + 1} מתוך {LOADING_STEPS.length}</span>
          <span dir="ltr">{Math.round(progress)}%</span>
        </div>
        <div className="h-1 w-full rounded-full bg-cream-dark overflow-hidden">
          <div
            className="h-full rounded-full bg-terra transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <span className="sr-only">טוען</span>
    </div>
  );
}

function RotatingArc({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`w-full h-full ${className}`} aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeDasharray="60 220"
        opacity="0.55"
      />
    </svg>
  );
}

function RotatingDots({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`w-full h-full ${className}`} aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="1 12"
        opacity="0.6"
      />
    </svg>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sage-pale text-sage-dark">
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
        <span className="absolute inset-1 rounded-full bg-terra-pale" />
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

"use client";

import { useEffect, useState } from "react";
import { MonogramDisc } from "./Marks";

export type CreationStep = "registering" | "uploading" | "restoring" | "booting" | "starting";

interface StepCopy {
  id: CreationStep;
  label: string;
  detail: string;
  // Share of the bar this step owns; inside a step the bar eases toward the ceiling
  // at the pace of `typicalSeconds` but never passes it until the real milestone arrives.
  weight: number;
  typicalSeconds: number;
}

const FRESH_STEPS: StepCopy[] = [
  { id: "registering", label: "שומרים את הסוכן", detail: "רושמים את הסוכן ומקצים לו מפתח מודל.", weight: 15, typicalSeconds: 3 },
  { id: "booting", label: "מקצים סביבה פרטית", detail: "יוצרים לסוכן קונטיינר משלו.", weight: 20, typicalSeconds: 5 },
  { id: "starting", label: "הסוכן עולה", detail: "OpenClaw נטען ועובר בדיקת תקינות — בדרך כלל כ־20 שניות.", weight: 65, typicalSeconds: 20 },
];

const RESTORE_STEPS: StepCopy[] = [
  { id: "uploading", label: "מעלים את קובץ הגיבוי", detail: "הקובץ נשלח לשרת בחלקים.", weight: 35, typicalSeconds: 30 },
  { id: "restoring", label: "משחזרים את הגיבוי", detail: "רושמים את הסוכן ומצמידים אליו את הגיבוי.", weight: 10, typicalSeconds: 4 },
  { id: "booting", label: "מקצים סביבה פרטית", detail: "יוצרים לסוכן קונטיינר משלו ומשחזרים את המצב.", weight: 15, typicalSeconds: 8 },
  { id: "starting", label: "הסוכן עולה", detail: "OpenClaw נטען ועובר בדיקת תקינות — בדרך כלל כ־20 שניות.", weight: 40, typicalSeconds: 20 },
];

const SECOND_MS = 1000;
const TICK_MS = 250;
const SLOW_AFTER_SECONDS = 60;
// The active step never shows as more than this much done — only the real milestone completes it.
const IN_STEP_CAP = 0.9;

export function CreatingPanel({
  name,
  restoring,
  step,
  uploadPercent,
}: {
  name: string;
  restoring: boolean;
  step: CreationStep;
  uploadPercent: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now());
  const [stepStartedAt, setStepStartedAt] = useState(startedAt);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setStepStartedAt(Date.now());
  }, [step]);

  const steps = restoring ? RESTORE_STEPS : FRESH_STEPS;
  const activeIndex = steps.findIndex((s) => s.id === step);
  const elapsedSeconds = Math.floor((now - startedAt) / SECOND_MS);
  const percent = resolvePercent(steps, activeIndex, (now - stepStartedAt) / SECOND_MS, uploadPercent);

  return (
    <div role="status" aria-live="polite" className="text-center">
      <div className="relative mx-auto mb-6 inline-flex">
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

      <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-2">מקימים סביבת סוכן</p>
      <h3 className="font-display text-2xl sm:text-3xl text-espresso mb-6 leading-tight break-words">
        {name ? `מקים את ${name}` : "מקים את הסוכן"}
      </h3>

      <div className="mx-auto mb-4 max-w-md text-start">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-espresso-light/70">
          <span>התקדמות</span>
          <span dir="ltr">{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="relative h-2 w-full overflow-hidden rounded-full bg-cream-dark"
        >
          <div
            className="h-full rounded-full bg-terra transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
          <span
            aria-hidden
            className="absolute inset-y-0 w-16 -translate-x-16 bg-gradient-to-r from-transparent via-white/55 to-transparent animate-runtime-sweep"
          />
        </div>
      </div>

      <ol className="mx-auto max-w-md space-y-2 text-start">
        {steps.map((s, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li
              key={s.id}
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                state === "active" ? "border-terra-light/60 bg-terra-pale/40" : "border-sand-light/70 bg-cream/40"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                <StepIcon state={state} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${state === "pending" ? "text-espresso-light" : "text-espresso"}`}>
                  {s.label}
                  {s.id === "uploading" && state === "active" && uploadPercent !== null ? (
                    <span dir="ltr" className="ms-2 font-mono text-xs text-espresso-light">
                      {uploadPercent}%
                    </span>
                  ) : null}
                </span>
                {state === "active" ? (
                  <span className="mt-0.5 block text-xs leading-relaxed text-espresso-light">{s.detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mx-auto mt-5 flex max-w-md items-center justify-between text-xs text-espresso-light">
        <span>{elapsedSeconds >= SLOW_AFTER_SECONDS ? "לוקח קצת יותר מהרגיל — עדיין ממתינים." : "כשהסוכן יהיה מוכן נציג כאן את שלב החיבור."}</span>
        <time dir="ltr" className="rounded-full border border-sand-light bg-white px-2.5 py-1 font-mono">
          {formatElapsed(elapsedSeconds)}
        </time>
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

function resolvePercent(
  steps: StepCopy[],
  activeIndex: number,
  secondsInStep: number,
  uploadPercent: number | null,
): number {
  if (activeIndex < 0) return 0;
  const floor = steps.slice(0, activeIndex).reduce((sum, s) => sum + s.weight, 0);
  const active = steps[activeIndex];
  const fraction =
    active.id === "uploading" && uploadPercent !== null
      ? uploadPercent / 100
      : 1 - Math.exp(-secondsInStep / active.typicalSeconds);
  return Math.round(floor + active.weight * Math.min(IN_STEP_CAP, fraction));
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

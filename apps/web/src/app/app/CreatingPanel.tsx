"use client";

import { useEffect, useState } from "react";
import { MonogramDisc } from "./Marks";

export type CreationStep = "registering" | "uploading" | "restoring" | "booting" | "starting";

export interface CreationTimelineEntry {
  id: CreationStep;
  // null when the step was already under way before this view mounted (page reload).
  startedAt: number | null;
  endedAt: number | null;
}

interface StepCopy {
  id: CreationStep;
  label: string;
  hint: string;
  // Share of the ring this step owns; inside a step the ring eases toward the ceiling
  // at the pace of `typicalSeconds` but only the real milestone completes it.
  weight: number;
  typicalSeconds: number;
}

const FRESH_STEPS: StepCopy[] = [
  { id: "registering", label: "שומרים את הסוכן", hint: "רושמים את הסוכן ומקצים לו מפתח מודל", weight: 15, typicalSeconds: 3 },
  { id: "booting", label: "מקצים סביבה פרטית", hint: "יוצרים לסוכן קונטיינר משלו", weight: 20, typicalSeconds: 5 },
  { id: "starting", label: "הסוכן עולה", hint: "OpenClaw נטען ועובר בדיקת תקינות", weight: 65, typicalSeconds: 20 },
];

const RESTORE_STEPS: StepCopy[] = [
  { id: "uploading", label: "מעלים את קובץ הגיבוי", hint: "הקובץ נשלח לשרת בחלקים", weight: 35, typicalSeconds: 30 },
  { id: "restoring", label: "משחזרים את הגיבוי", hint: "רושמים את הסוכן ומצמידים אליו את הגיבוי", weight: 10, typicalSeconds: 4 },
  { id: "booting", label: "מקצים סביבה פרטית", hint: "יוצרים לסוכן קונטיינר משלו ומשחזרים את המצב", weight: 15, typicalSeconds: 8 },
  { id: "starting", label: "הסוכן עולה", hint: "OpenClaw נטען ועובר בדיקת תקינות", weight: 40, typicalSeconds: 20 },
];

const TICK_MS = 200;
const SLOW_AFTER_MS = 60_000;
const IN_STEP_CAP = 0.9;
const RING_SIZE = 96;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type StepState = "done" | "active" | "pending" | "failed";

export function CreatingPanel({
  name,
  restoring,
  timeline,
  uploadPercent,
  ready,
  failure,
  onRetry,
}: {
  name: string;
  restoring: boolean;
  timeline: CreationTimelineEntry[];
  uploadPercent: number | null;
  ready: boolean;
  failure: string | null;
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (ready || failure) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [ready, failure]);

  const steps = restoring ? RESTORE_STEPS : FRESH_STEPS;
  const current = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const activeIndex = ready ? steps.length : steps.findIndex((s) => s.id === current?.id);
  const startedAt = timeline[0]?.startedAt ?? mountedAt;
  const elapsedMs = Math.max(0, now - startedAt);
  const secondsInStep = current?.startedAt ? Math.max(0, now - current.startedAt) / 1000 : 0;
  const percent = ready ? 100 : resolvePercent(steps, activeIndex, secondsInStep, uploadPercent);
  const stepNumber = Math.min(activeIndex + 1, steps.length);
  const activeStep = steps[activeIndex];

  const status = failure
    ? `ההקמה נכשלה בשלב ${stepNumber}`
    : ready
      ? "מוכן"
      : `שלב ${stepNumber} מתוך ${steps.length} · ${activeStep?.label ?? ""}`;

  const footer = failure
    ? failure
    : elapsedMs >= SLOW_AFTER_MS
      ? "לוקח יותר מהרגיל — עדיין ממתינים לבדיקת התקינות."
      : "אפשר לסגור את הדף — ההקמה ממשיכה בשרת.";

  return (
    <div role="status" aria-live="polite" aria-busy={!ready && !failure}>
      <div className="flex items-center gap-5">
        <ProgressRing percent={percent} ready={ready} failed={failure !== null}>
          <MonogramDisc letter={name || "א"} size="md" />
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-1">
            {ready ? "הסוכן מוכן" : "מקימים את הסוכן"}
          </p>
          <h3 className="font-display text-2xl sm:text-[1.75rem] text-espresso leading-tight break-words">{name}</h3>
          <p className="relative mt-1 h-[21px] overflow-hidden text-sm text-espresso-light">
            <span key={status} className="absolute inset-0 animate-status-in">
              {status}
            </span>
          </p>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span
              dir="ltr"
              className={`font-mono text-xl font-semibold tabular-nums leading-none transition-colors duration-300 ${
                failure ? "text-red-700" : ready ? "text-sage-dark" : "text-espresso"
              }`}
            >
              {percent}%
            </span>
            {!ready && !failure && elapsedMs < SLOW_AFTER_MS ? (
              <span className="text-xs text-espresso-light">בדרך כלל כחצי דקה</span>
            ) : null}
          </div>
        </div>
      </div>

      <ol className="mt-6 border-t border-sand-light">
        {steps.map((step, i) => {
          const entry = timeline.find((t) => t.id === step.id);
          const state: StepState =
            failure && i === activeIndex ? "failed" : ready || i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          const duration = entry?.startedAt && entry.endedAt ? formatDuration(entry.endedAt - entry.startedAt) : null;
          return (
            <li
              key={step.id}
              className="grid h-[52px] grid-cols-[28px_1fr_auto] items-center gap-3.5 border-b border-sand-light/60"
            >
              <StepIcon state={state} />
              <span className="min-w-0">
                <span
                  className={`block text-[15px] leading-tight transition-colors duration-300 ${
                    state === "pending" ? "text-espresso-light/60" : state === "failed" ? "text-red-700" : "text-espresso"
                  }`}
                >
                  {step.label}
                  {step.id === "uploading" && state === "active" && uploadPercent !== null ? (
                    <span dir="ltr" className="ms-2 font-mono text-xs text-espresso-light">
                      {uploadPercent}%
                    </span>
                  ) : null}
                </span>
                <span
                  className={`block h-4 truncate text-xs leading-4 text-espresso-light transition-opacity duration-300 ${
                    state === "active" ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {step.hint}
                </span>
              </span>
              <span
                dir="ltr"
                className={`font-mono text-xs tabular-nums text-espresso-light transition-opacity duration-300 ${
                  state === "done" && duration ? "opacity-80" : "opacity-0"
                }`}
              >
                {duration ?? ""}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-espresso-light">
        <span className={failure ? "text-red-700" : undefined}>{footer}</span>
        <time dir="ltr" className="shrink-0 rounded-full border border-sand-light bg-white px-2.5 py-1 font-mono tabular-nums">
          {formatElapsed(elapsedMs)}
        </time>
      </div>

      {failure && onRetry ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl border border-sand bg-white px-4 py-2.5 text-sm font-medium text-espresso transition hover:border-terra hover:bg-terra-pale/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra"
          >
            נסו שוב
          </button>
        </div>
      ) : null}

      <span className="sr-only">{ready ? "הסוכן מוכן" : failure ? "ההקמה נכשלה" : "טוען"}</span>
    </div>
  );
}

function ProgressRing({
  percent,
  ready,
  failed,
  children,
}: {
  percent: number;
  ready: boolean;
  failed: boolean;
  children: React.ReactNode;
}) {
  const offset = RING_CIRCUMFERENCE * (1 - percent / 100);
  const stroke = failed ? "stroke-red-600" : ready ? "stroke-sage" : "stroke-terra";
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="relative shrink-0"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg width={RING_SIZE} height={RING_SIZE} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} className="stroke-cream-dark" />
        {!ready && !failed ? (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`12 ${RING_CIRCUMFERENCE - 12}`}
            className="stroke-terra-light/60 animate-ring-orbit"
          />
        ) : null}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={`${stroke} transition-[stroke-dashoffset,stroke] duration-500 ease-linear`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </span>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sage-pale text-sage-dark animate-status-in">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-terra-pale">
        <span className="absolute inset-[3px] rounded-full border-2 border-terra border-e-transparent animate-spin" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-50 text-sm font-bold text-red-700">!</span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sand-light">
      <span className="h-1.5 w-1.5 rounded-full bg-sand-light" />
    </span>
  );
}

function resolvePercent(steps: StepCopy[], activeIndex: number, secondsInStep: number, uploadPercent: number | null): number {
  if (activeIndex < 0) return 0;
  const floor = steps.slice(0, activeIndex).reduce((sum, s) => sum + s.weight, 0);
  const active = steps[activeIndex];
  if (!active) return Math.min(100, floor);
  const fraction =
    active.id === "uploading" && uploadPercent !== null
      ? uploadPercent / 100
      : 1 - Math.exp(-secondsInStep / active.typicalSeconds);
  return Math.round(floor + active.weight * Math.min(IN_STEP_CAP, fraction));
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

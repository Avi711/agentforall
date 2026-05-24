"use client";

import { useEffect, useState } from "react";
import { MonogramDisc } from "./Marks";

const QUICK_CHECKS = [
  "פרטי הסוכן נשמרו",
  "סביבת עבודה הוקצתה",
  "ההרצה נשלחה לשרת",
];

const SECOND_MS = 1000;

export function CreatingPanel({ name }: { name: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / SECOND_MS));
    }, SECOND_MS);
    return () => clearInterval(id);
  }, []);

  const phase = resolveProvisioningPhase(elapsedSeconds);
  const progress = resolveProgress(elapsedSeconds);

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative rounded-[28px] border border-sand-light bg-white shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] px-6 py-9 sm:px-10 sm:py-11 text-center overflow-hidden"
    >
      <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />

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

      <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-2">
        מקימים סביבת סוכן
      </p>
      <h3 className="font-display text-2xl sm:text-3xl text-espresso mb-2 leading-tight">
        {name ? `מקים את ${name}` : "מקים את הסוכן"}
      </h3>
      <p className="text-sm text-espresso-light mb-7 italic">
        ההכנה הראשונית מהירה; ההפעלה של OpenClaw היא החלק שלוקח זמן.
      </p>

      <ol className="grid gap-2.5 sm:grid-cols-3 text-right mb-7">
        {QUICK_CHECKS.map((label) => (
          <li
            key={label}
            className="flex items-center gap-2.5 text-xs sm:text-[13px] text-espresso bg-cream/55 border border-sand-light/70 rounded-lg px-3 py-2.5"
          >
            <StepIcon state="done" />
            <span className="leading-snug">{label}</span>
          </li>
        ))}
      </ol>

      <div className="border-y border-sand-light/75 py-6 text-right">
        <div className="flex items-start justify-between gap-5 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-2">
              <StepIcon state="active" />
              <p className="text-[11px] uppercase tracking-[0.18em] text-terra">
                השלב המרכזי
              </p>
            </div>
            <h4 className="font-display text-xl text-espresso leading-tight">
              {phase.title}
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-espresso-light">
              {phase.description}
            </p>
          </div>
          <time
            dir="ltr"
            className="shrink-0 rounded-full border border-sand-light bg-white px-3 py-1.5 font-mono text-xs text-espresso-light"
          >
            {formatElapsed(elapsedSeconds)}
          </time>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-espresso-light/70 mb-2">
            <span>מפעיל את סביבת הסוכן</span>
            <span dir="ltr">{Math.round(progress)}%</span>
          </div>
          <div className="relative h-2 w-full rounded-full bg-cream-dark overflow-hidden">
            <div
              className="h-full rounded-full bg-terra transition-[width] duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-16 -translate-x-16 bg-gradient-to-r from-transparent via-white/55 to-transparent animate-runtime-sweep"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-espresso-light">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sage animate-ember" />
          <span>{phase.note}</span>
        </div>
      </div>

      <p className="mt-5 text-xs text-espresso-light/80 leading-relaxed">
        כשהסוכן יהיה מוכן נעבור אוטומטית למסך חיבור WhatsApp.
      </p>

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

interface ProvisioningPhase {
  title: string;
  description: string;
  note: string;
}

function resolveProvisioningPhase(elapsedSeconds: number): ProvisioningPhase {
  if (elapsedSeconds >= 180) {
    return {
      title: "זה לוקח יותר מהרגיל",
      description: "אנחנו עדיין מחכים שהשער של הסוכן יסיים לעלות. אפשר להשאיר את המסך פתוח.",
      note: "אם זה לא משתנה בקרוב, נציג אפשרות ניסיון מחדש.",
    };
  }
  if (elapsedSeconds >= 90) {
    return {
      title: "עדיין מפעילים את הסוכן",
      description: "המערכת כבר נוצרה; עכשיו אנחנו ממתינים לאישור שהשער הפנימי עונה בצורה תקינה.",
      note: "זמן ארוך מהרגיל, אבל התהליך עדיין פעיל.",
    };
  }
  return {
    title: "מפעילים את הסוכן",
    description: "OpenClaw עולה בתוך קונטיינר פרטי, טוען את ההגדרות ומחכה לבדיקת בריאות ראשונה.",
    note: "בדרך כלל זה מסתיים בתוך דקה.",
  };
}

function resolveProgress(elapsedSeconds: number): number {
  if (elapsedSeconds < 75) return 42 + (elapsedSeconds / 75) * 40;
  if (elapsedSeconds < 150) return 82 + ((elapsedSeconds - 75) / 75) * 10;
  return Math.min(96, 92 + ((elapsedSeconds - 150) / 180) * 4);
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

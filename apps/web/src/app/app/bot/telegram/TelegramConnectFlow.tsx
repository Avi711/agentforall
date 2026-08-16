"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

const STATUS_POLL_INTERVAL_MS = 2000;

type Phase =
  | { kind: "starting" }
  | { kind: "pending"; deepLink: string }
  | { kind: "connected"; botUsername: string | null }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

export function TelegramConnectFlow({ botId }: { botId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function startLink() {
      try {
        const res = await fetch(`/api/bot/${botId}/telegram/link`, {
          method: "POST",
          cache: "no-store",
        });
        const data: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setPhase(
            isFeatureUnavailable(data)
              ? { kind: "unavailable" }
              : { kind: "error", message: UNEXPECTED_ERROR_HE },
          );
          return;
        }
        if (!isLinkResponse(data)) {
          setPhase({ kind: "error", message: UNEXPECTED_ERROR_HE });
          return;
        }
        setPhase({ kind: "pending", deepLink: data.deepLink });
      } catch {
        if (!cancelled) setPhase({ kind: "error", message: UNEXPECTED_ERROR_HE });
      }
    }

    startLink();
    return () => {
      cancelled = true;
    };
  }, [botId, attempt]);

  useEffect(() => {
    if (phase.kind !== "pending") return;
    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/bot/${botId}/telegram/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: unknown = await res.json().catch(() => null);
        if (cancelled || !isStatusResponse(data)) return;
        if (data.status === "connected") {
          setPhase({ kind: "connected", botUsername: data.botUsername });
        }
      } catch {
        // Best-effort poll; the next tick retries.
      }
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase.kind, botId]);

  if (phase.kind === "connected") {
    return <ConnectedPanel botUsername={phase.botUsername} />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-8 max-w-2xl">
      <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">
        חיבור טלגרם
      </p>
      <h2 className="font-display text-2xl text-espresso mb-3">
        שתי לחיצות ויש לכם סוכן בטלגרם
      </h2>

      {phase.kind === "unavailable" ? (
        <p className="text-sm text-espresso-light leading-relaxed">
          חיבור טלגרם אינו זמין כרגע. נסו שוב מאוחר יותר, או חזרו{" "}
          <Link href="/app" className="text-terra underline">
            לעמוד הבית
          </Link>
          .
        </p>
      ) : phase.kind === "error" ? (
        <div className="space-y-4">
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: "starting" });
              setAttempt((n) => n + 1);
            }}
            className="px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition"
          >
            ניסיון נוסף
          </button>
        </div>
      ) : (
        <>
          <ol className="space-y-4 mb-8 text-espresso">
            <StepItem number={1} title="פתחו את טלגרם">
              הכפתור למטה יפתח מסך יצירת בוט — הכול כבר מלא מראש.
            </StepItem>
            <StepItem number={2} title="אשרו את היצירה">
              לחצו על האישור בטלגרם. אל תשנו את שם המשתמש המוצע — כך נזהה את
              הבוט שלכם.
            </StepItem>
          </ol>

          {phase.kind === "pending" ? (
            <a
              href={phase.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <TelegramGlyph />
              <span>יצירת הבוט בטלגרם</span>
            </a>
          ) : (
            <div className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-cream-dark text-espresso-light font-medium">
              <Spinner />
              <span>מכינים את הקישור…</span>
            </div>
          )}

          {phase.kind === "pending" ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-6 flex items-center gap-2.5 text-sm text-espresso-light"
            >
              <Spinner />
              ממתינים לאישור בטלגרם — ברגע שתאשרו, נמשיך אוטומטית.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ConnectedPanel({ botUsername }: { botUsername: string | null }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-8 max-w-2xl">
      <p className="text-xs uppercase tracking-[0.22em] text-sage-dark mb-3">
        מחובר
      </p>
      <h2 className="font-display text-2xl text-espresso mb-3">
        הסוכן שלכם מחובר לטלגרם 🎉
      </h2>
      <p className="text-espresso-light leading-relaxed mb-8 max-w-md">
        נשאר רק לומר שלום. ההודעה הראשונה עשויה להגיע אחרי כ-30–40 שניות —
        הסוכן עולה ברגעים אלו.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {botUsername ? (
          <a
            href={`https://t.me/${botUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition"
          >
            <TelegramGlyph />
            <span>פתחו את @{botUsername} ושלחו הודעה</span>
          </a>
        ) : null}
        <Link
          href="/app"
          className="px-6 py-3 rounded-xl text-espresso-light hover:text-espresso hover:bg-cream-dark transition"
        >
          לעמוד הבית
        </Link>
      </div>
    </div>
  );
}

function StepItem({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terra-pale text-terra font-medium">
        {number}
      </span>
      <div className="pt-0.5">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-espresso-light leading-relaxed">
          {children}
        </p>
      </div>
    </li>
  );
}

// The web API wraps the orchestrator error as error.details.code.
function isFeatureUnavailable(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const error = (data as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return false;
  return (details as { code?: unknown }).code === "FEATURE_UNAVAILABLE";
}

function isLinkResponse(data: unknown): data is { deepLink: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "deepLink" in data &&
    typeof (data as { deepLink?: unknown }).deepLink === "string"
  );
}

function isStatusResponse(
  data: unknown,
): data is { status: string; botUsername: string | null } {
  return (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    typeof (data as { status?: unknown }).status === "string"
  );
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="download-spinner w-4 h-4" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TelegramGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  WhatsappAccess,
  WhatsappAccessUpdate,
  WhatsappPendingSender,
} from "@/lib/orchestrator/types";
import type { WhatsappAccessSnapshot } from "@/lib/bots/snapshot";
import { isValidIsraeliPhone, normalizeIsraeliPhone } from "@/lib/phone";

const CLAIM_POLL_MS = 5000;
const IDLE_POLL_MS = 45_000;
const INTERNATIONAL_RE = /^\+[1-9]\d{6,14}$/;

type Busy = "approve" | "access" | "manual" | "self" | "claim" | null;

export function WhatsAppAccessSection({
  botId,
  botNumber,
  initial,
}: {
  botId: string;
  botNumber: string;
  initial: WhatsappAccessSnapshot;
}) {
  const router = useRouter();
  const [view, setView] = useState<WhatsappAccess>(() => fromSnapshot(initial, botNumber));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const viewRef = useRef(view);
  viewRef.current = view;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Bumped on every successful PATCH so an in-flight poll can't overwrite fresher state.
  const generation = useRef(0);

  useEffect(() => {
    setView(fromSnapshot(initial, botNumber));
  }, [initial.ownerNumber, initial.access, initial.configured, botNumber]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      const delay = viewRef.current.claiming ? CLAIM_POLL_MS : IDLE_POLL_MS;
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      timer = null;
      if (cancelled) return;
      if (document.visibilityState === "hidden" || busyRef.current) {
        schedule();
        return;
      }
      const startedAt = generation.current;
      try {
        const res = await fetch(`/api/bot/${botId}/whatsapp/access`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as WhatsappAccess;
          if (!cancelled && startedAt === generation.current) setView(data);
        }
      } catch {
        // Best-effort poll; the next tick retries.
      }
      schedule();
    };

    void tick();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !timer) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [botId]);

  async function apply(kind: Exclude<Busy, null>, patch: WhatsappAccessUpdate) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/bot/${botId}/whatsapp/access`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(body) ?? "השמירה נכשלה");
      generation.current += 1;
      setView(body as WhatsappAccess);
      setManualOpen(false);
      setManualPhone("");
      setNotice("נשמר. הבוט מופעל מחדש — ההודעה הבאה תיענה תוך כדקה.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  function submitManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = normalizeManualPhone(manualPhone);
    if (!normalized) {
      setError("המספר לא תקין. אפשר 050-1234567 או +972…");
      return;
    }
    void apply("manual", { ownerNumber: normalized });
  }

  const ownerIsBot = view.ownerNumber !== null && view.ownerNumber === view.botNumber;

  return (
    <section className="mb-6 sm:mb-7 -mx-1 px-1" aria-labelledby="wa-access-title">
      <p
        id="wa-access-title"
        className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2"
      >
        מי יכול לכתוב לבוט
      </p>

      {view.claiming ? (
        <ClaimPanel
          view={view}
          busy={busy}
          onApprove={(sender) => apply("approve", { ownerNumber: sender.number })}
          onSelf={() => apply("self", { ownerNumber: view.botNumber })}
        />
      ) : view.ownerNumber ? (
        <OwnerPanel
          view={view}
          ownerIsBot={ownerIsBot}
          busy={busy}
          onAccess={(access) => apply("access", { access })}
          onReclaim={() => apply("claim", { ownerNumber: null, access: "owner" })}
        />
      ) : (
        <LegacyPanel busy={busy} onRestrict={() => apply("claim", { access: "owner" })} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          aria-expanded={manualOpen}
          className="py-2 text-espresso-light underline-offset-4 hover:text-espresso hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded"
        >
          {view.ownerNumber ? "שינוי המספר ידנית" : "להזין מספר ידנית"}
        </button>
      </div>

      {manualOpen ? (
        <form onSubmit={submitManual} className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <label className="sr-only" htmlFor="wa-owner-phone">
            המספר שלכם בוואטסאפ
          </label>
          <input
            id="wa-owner-phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder="050-1234567"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
            className="w-full sm:max-w-[14rem] rounded-xl border border-sand-light bg-cream px-4 py-3 font-mono text-base text-espresso placeholder:text-espresso-light/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra"
          />
          <button
            type="submit"
            disabled={busy !== null || !normalizeManualPhone(manualPhone)}
            className="inline-flex w-full sm:w-auto items-center justify-center px-5 py-3 rounded-xl bg-espresso text-cream font-medium hover:bg-espresso-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === "manual" ? "שומר…" : "שמירה"}
          </button>
        </form>
      ) : null}

      {notice ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-terra">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ClaimPanel({
  view,
  busy,
  onApprove,
  onSelf,
}: {
  view: WhatsappAccess;
  busy: Busy;
  onApprove: (sender: WhatsappPendingSender) => void;
  onSelf: () => void;
}) {
  return (
    <div className="rounded-2xl border border-terra-light/40 bg-terra-pale/50 p-4 sm:p-5">
      <p className="font-medium text-espresso leading-snug">נזהה אתכם לפי ההודעה הראשונה</p>
      <p className="mt-1.5 text-sm text-espresso-light leading-relaxed">
        שלחו הודעה כלשהי לבוט מהוואטסאפ שלכם. המספר יופיע כאן — אשרו שזה אתם, ומאותו רגע רק
        אתם תוכלו לדבר איתו.
      </p>

      {view.pending.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {view.pending.map((sender) => (
            <li
              key={sender.number}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-sand-light px-4 py-3"
            >
              <div className="min-w-0">
                <span dir="ltr" className="block font-mono text-base text-espresso break-all">
                  {sender.number}
                </span>
                {sender.name ? (
                  <span className="block text-xs text-espresso-light mt-0.5 truncate">{sender.name}</span>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onApprove(sender)}
                className="inline-flex w-full sm:w-auto items-center justify-center px-5 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-wait"
              >
                {busy === "approve" ? "מאשר…" : "זה אני"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-espresso-light">
          <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-terra animate-pulse" />
          {view.pendingUnavailable
            ? "לא הצלחנו לבדוק הודעות נכנסות כרגע — מנסים שוב."
            : "ממתינים להודעה שלכם…"}
        </p>
      )}

      {view.botNumber ? (
        <p className="mt-4 text-sm text-espresso-light">
          כותבים לבוט מאותו מספר שהוא מחובר אליו?{" "}
          <button
            type="button"
            disabled={busy !== null}
            onClick={onSelf}
            className="py-2 text-espresso underline underline-offset-4 hover:text-terra focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded disabled:opacity-60"
          >
            {busy === "self" ? "שומר…" : "כן, זה המספר שלי"}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function OwnerPanel({
  view,
  ownerIsBot,
  busy,
  onAccess,
  onReclaim,
}: {
  view: WhatsappAccess;
  ownerIsBot: boolean;
  busy: Busy;
  onAccess: (access: "owner" | "open") => void;
  onReclaim: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span dir="ltr" className="font-mono text-base sm:text-lg text-espresso break-all">
          {view.ownerNumber}
        </span>
        <span className="text-xs text-espresso-light">
          {ownerIsBot ? "המספר של הבוט (שיחה עם עצמי)" : "המספר שלכם"}
        </span>
        <button
          type="button"
          disabled={busy !== null}
          onClick={onReclaim}
          className="py-2 text-sm text-espresso-light underline-offset-4 hover:text-espresso hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded disabled:opacity-60"
        >
          {busy === "claim" ? "שומר…" : "זיהוי מחדש לפי הודעה"}
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="מי יכול לכתוב לבוט"
        className="inline-flex w-full sm:w-auto rounded-xl bg-cream-dark p-1 gap-1"
      >
        <AccessOption
          label="רק אני"
          checked={view.access === "owner"}
          disabled={busy !== null}
          onSelect={() => onAccess("owner")}
        />
        <AccessOption
          label="כולם"
          checked={view.access === "open"}
          disabled={busy !== null}
          onSelect={() => onAccess("open")}
        />
      </div>

      <p className="text-xs text-espresso-light leading-relaxed max-w-md">
        {view.access === "open"
          ? "כל מי שישלח הודעה לבוט יקבל מענה — בשיחה נפרדת משלכם, בלי גישה להיסטוריה שלכם."
          : "רק ההודעות שלכם מגיעות לבוט. אחרים לא יקבלו מענה."}
      </p>
    </div>
  );
}

function LegacyPanel({ busy, onRestrict }: { busy: Busy; onRestrict: () => void }) {
  return (
    <div className="rounded-2xl border border-sand-light bg-cream-dark/60 p-4 sm:p-5">
      <p className="text-sm text-espresso leading-relaxed">
        כרגע כל אחד יכול לכתוב לבוט. אפשר להגביל אותו רק אליכם — נזהה את המספר שלכם לפי
        ההודעה הבאה שתשלחו.
      </p>
      <button
        type="button"
        disabled={busy !== null}
        onClick={onRestrict}
        className="mt-3 inline-flex w-full sm:w-auto items-center justify-center px-5 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-wait"
      >
        {busy === "claim" ? "שומר…" : "הגבלה רק אליי"}
      </button>
    </div>
  );
}

function AccessOption({
  label,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!checked) onSelect();
      }}
      className={`flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-sm font-medium leading-snug text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:cursor-wait ${
        checked
          ? "bg-white text-espresso shadow-[0_1px_2px_rgba(44,24,16,0.08)]"
          : "text-espresso-light hover:text-espresso"
      }`}
    >
      {label}
    </button>
  );
}

function fromSnapshot(initial: WhatsappAccessSnapshot, botNumber: string): WhatsappAccess {
  return {
    botNumber,
    ownerNumber: initial.ownerNumber,
    access: initial.access,
    configured: initial.configured,
    claiming: initial.access === "owner" && initial.ownerNumber === null,
    pending: [],
    pendingUnavailable: false,
  };
}

function normalizeManualPhone(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("+")) {
    const compact = value.replace(/[\s().-]/g, "");
    return INTERNATIONAL_RE.test(compact) ? compact : null;
  }
  return isValidIsraeliPhone(value) ? `+${normalizeIsraeliPhone(value)}` : null;
}

function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

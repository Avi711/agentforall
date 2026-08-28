"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRefresh } from "./Pending";
import type { OwnerCandidate, OwnerIdentity } from "@/lib/orchestrator/types";
import type { OwnerSnapshot } from "@/lib/bots/snapshot";
import { readApiErrorMessage } from "@/lib/http/api-error";
import { normalizePhoneInput } from "@/lib/phone";

const CANDIDATES_POLL_MS = 5000;

export const IDENTITY_HINT =
  "המספר וחשבון הטלגרם שהבוט מזהה כבעלים שלו. השיחה נשמרת אחת בין הערוצים, ופעולות ניהול פתוחות רק להם.";
const TELEGRAM_HINT = "מזוהה אוטומטית כשמחברים את הבוט לטלגרם — החשבון שלחץ על ״התחל״ הוא הבעלים.";
const WHATSAPP_HINT = "המספר האישי שממנו אתם כותבים לבוט — לא המספר של הבוט עצמו.";

export function OwnerIdentityDialog({
  open,
  botId,
  initial,
  whatsappAvailable,
  onClose,
}: {
  open: boolean;
  botId: string;
  initial: OwnerSnapshot;
  whatsappAvailable: boolean;
  onClose: () => void;
}) {
  const { refreshing, refresh } = useRefresh();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const phoneId = useId();

  const [view, setView] = useState<OwnerIdentity | null>(null);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = posting || refreshing;

  const number = view ? view.whatsappNumber : initial.whatsappNumber;
  const telegramLinked = view ? view.telegram !== null : initial.telegramLinked;
  const showInput = whatsappAvailable && (number === null || editing);
  const candidates = view?.candidates ?? [];

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bot/${botId}/owner`, { cache: "no-store" });
      if (res.ok) setView((await res.json()) as OwnerIdentity);
    } catch {
      // Best-effort; the next poll retries.
    }
  }, [botId]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setView(null);
      setEditing(false);
      setPhone("");
      setError(null);
      el.showModal();
      void load();
    }
    if (!open && el.open) el.close();
  }, [open, load]);

  // Candidates only change while no number is set; poll just then.
  useEffect(() => {
    if (!open || number !== null) return;
    const timer = setInterval(() => void load(), CANDIDATES_POLL_MS);
    return () => clearInterval(timer);
  }, [open, number, load]);

  async function save(whatsappNumber: string | null) {
    if (saving) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bot/${botId}/owner`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whatsappNumber }),
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readApiErrorMessage(body) ?? "השמירה נכשלה");
      setPosting(false);
      // Close only once the card behind the dialog already shows the new number.
      refresh(() => dialogRef.current?.close());
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה");
      setPosting(false);
    }
  }

  function submitTyped() {
    const normalized = normalizePhoneInput(phone);
    if (!normalized) {
      setError("המספר לא תקין. אפשר 050-1234567 או מספר בינלאומי מלא.");
      return;
    }
    void save(normalized);
  }

  function cancel() {
    if (saving) return;
    if (editing && number !== null) {
      setEditing(false);
      setError(null);
      return;
    }
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        if (!saving) onClose();
      }}
      onClick={(e) => {
        // Backdrop = the dialog element itself; content sits in the inner form.
        if (e.target === dialogRef.current && !saving) dialogRef.current?.close();
      }}
      aria-labelledby={titleId}
      className="fixed inset-0 m-auto backdrop:bg-espresso/40 rounded-2xl p-0 w-[min(92vw,480px)] max-h-[85dvh] overflow-y-auto overscroll-contain border border-sand-light shadow-[0_20px_48px_rgba(44,24,16,0.18)]"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (showInput) submitTyped();
        }}
        dir="rtl"
      >
        <div className="p-5 sm:p-7">
          <h2 id={titleId} className="font-display text-xl text-espresso mb-1">
            הזהות שלי
          </h2>
          <p className="text-sm text-espresso-light leading-relaxed mb-5">{IDENTITY_HINT}</p>

          <ul className="divide-y divide-sand-light/70 border-y border-sand-light/70">
            <IdentityRow name="Telegram" hint={TELEGRAM_HINT}>
              <span className={`text-sm ${telegramLinked ? "text-sage-dark" : "text-espresso-light"}`}>
                {telegramLinked ? "מקושר ✓" : "לא מחובר"}
              </span>
            </IdentityRow>

            <IdentityRow name="WhatsApp" hint={WHATSAPP_HINT}>
              {!whatsappAvailable ? (
                <span className="text-sm text-espresso-light">לא מחובר</span>
              ) : number !== null && !editing ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-sm text-espresso break-all">
                    {number}
                  </span>
                  <SmallButton
                    disabled={saving}
                    onClick={() => {
                      setEditing(true);
                      setPhone("");
                      setError(null);
                    }}
                  >
                    שינוי
                  </SmallButton>
                  <SmallButton disabled={saving} onClick={() => void save(null)}>
                    הסרה
                  </SmallButton>
                </span>
              ) : (
                <span className="text-sm text-espresso-light">המספר שלי</span>
              )}
            </IdentityRow>
          </ul>

          {showInput ? (
            <div className="mt-4">
              {candidates.length > 0 ? (
                <>
                  <p className="text-xs text-espresso-light mb-2">כתבו לבוט לאחרונה — זה אתם?</p>
                  <ul className="mb-4 space-y-2">
                    {candidates.map((candidate) => (
                      <CandidateRow
                        key={candidate.number}
                        candidate={candidate}
                        disabled={saving}
                        onPick={() => void save(candidate.number)}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
              <label htmlFor={phoneId} className="block text-sm text-espresso-light mb-1.5">
                {candidates.length > 0 ? "או הקלידו את המספר" : "הקלידו את המספר שלכם"}
              </label>
              <input
                id={phoneId}
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                placeholder="050-1234567"
                value={phone}
                disabled={saving}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-sand bg-white px-4 py-3 font-mono text-sm text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale disabled:opacity-50"
              />
              {view?.candidatesUnavailable ? (
                <p className="mt-2 text-xs text-espresso-light">לא הצלחנו לבדוק הודעות נכנסות כרגע.</p>
              ) : null}
            </div>
          ) : null}

          <SyncLine view={view} hasOwner={telegramLinked || number !== null} />

          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-5 pb-5 sm:px-7 sm:pb-6">
          {saving && !showInput ? (
            <p role="status" className="sm:me-auto text-sm text-espresso-light">
              שומר…
            </p>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="px-4 py-3 rounded-lg text-sm text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
          >
            {showInput ? "ביטול" : "סגירה"}
          </button>
          {showInput ? (
            <button
              type="submit"
              disabled={saving || phone.trim() === ""}
              aria-busy={saving}
              className="px-4 py-3 rounded-lg text-sm font-medium bg-espresso text-cream hover:bg-espresso-light transition disabled:opacity-60 disabled:cursor-wait"
            >
              {saving ? "שומר…" : "שמירה"}
            </button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}

// Hints are always visible: a floating tooltip at a dialog edge gets clipped and nobody hovers on mobile.
function IdentityRow({ name, hint, children }: { name: string; hint: string; children: ReactNode }) {
  return (
    <li className="py-3.5 flex items-start gap-3">
      <span className="w-20 shrink-0 pt-0.5 text-sm font-medium text-espresso">{name}</span>
      <div className="min-w-0 flex-1">
        {children}
        <p className="mt-1 text-xs text-espresso-light/80 leading-relaxed">{hint}</p>
      </div>
    </li>
  );
}

function CandidateRow({
  candidate,
  disabled,
  onPick,
}: {
  candidate: OwnerCandidate;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-light bg-cream px-4 py-3">
      <div className="min-w-0">
        <span dir="ltr" className="block font-mono text-sm text-espresso break-all">
          {candidate.number}
        </span>
        {candidate.name ? (
          <span className="block text-xs text-espresso-light mt-0.5 truncate">{candidate.name}</span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-sand text-espresso text-sm font-medium hover:bg-cream-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60 disabled:cursor-wait"
      >
        זה אני
      </button>
    </li>
  );
}

function SmallButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-3 py-1.5 rounded-full border border-sand-light text-xs text-espresso hover:bg-cream-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60"
    >
      {children}
    </button>
  );
}

// Ground truth from the running bot, not just what we stored.
function SyncLine({ view, hasOwner }: { view: OwnerIdentity | null; hasOwner: boolean }) {
  if (!view || !hasOwner || view.sync === "unavailable") return null;
  if (view.sync === "applied") {
    return <p className="mt-4 text-xs text-sage-dark">מעודכן בבוט ✓</p>;
  }
  return (
    <p className="mt-4 flex items-center gap-2 text-xs text-espresso-light">
      <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-terra animate-pulse" />
      מתעדכן בבוט… (עד דקה)
    </p>
  );
}

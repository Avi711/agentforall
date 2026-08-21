"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  WhatsappAccess,
  WhatsappDmAccess,
  WhatsappPendingSender,
} from "@/lib/orchestrator/types";
import type { WhatsappAccessSnapshot } from "@/lib/bots/snapshot";
import { isValidIsraeliPhone, normalizeIsraeliPhone } from "@/lib/phone";

const CLAIM_POLL_MS = 5000;
const INTERNATIONAL_RE = /^\+[1-9]\d{6,14}$/;

export function accessLabel(initial: WhatsappAccessSnapshot): string {
  if (initial.access !== "owner") return "פתוח לכולם";
  return initial.ownerNumber === null ? "רק אני — מזהה מספר" : "רק אני";
}

export function WhatsAppAccessDialog({
  open,
  botId,
  botNumber,
  initial,
  onClose,
}: {
  open: boolean;
  botId: string;
  botNumber: string;
  initial: WhatsappAccessSnapshot;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const phoneId = useId();

  const [access, setAccess] = useState<WhatsappDmAccess>(initial.access);
  const [owner, setOwner] = useState<string | null>(initial.ownerNumber);
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<WhatsappPendingSender[]>([]);
  const [pendingUnavailable, setPendingUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsIdentity = access === "owner" && owner === null;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setAccess(initial.access);
      setOwner(initial.ownerNumber);
      setPhone("");
      setError(null);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, initial.access, initial.ownerNumber]);

  // Pending senders matter only while the dialog is open and no number is known yet.
  useEffect(() => {
    if (!open || !needsIdentity) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      timer = null;
      try {
        const res = await fetch(`/api/bot/${botId}/whatsapp/access`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as WhatsappAccess;
          setPending(data.pending);
          setPendingUnavailable(data.pendingUnavailable);
        }
      } catch {
        // Best-effort poll; the next tick retries.
      }
      if (!cancelled) timer = setTimeout(tick, CLAIM_POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, needsIdentity, botId]);

  async function save(ownerOverride?: string | null) {
    if (saving) return;
    let resolvedOwner = ownerOverride !== undefined ? ownerOverride : owner;
    const typed = phone.trim();
    if (ownerOverride === undefined && access === "owner" && resolvedOwner === null && typed) {
      const normalized = normalizeManualPhone(typed);
      if (!normalized) {
        setError("המספר לא תקין. אפשר 050-1234567 או מספר בינלאומי מלא.");
        return;
      }
      resolvedOwner = normalized;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bot/${botId}/whatsapp/access`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access, ownerNumber: resolvedOwner }),
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(body) ?? "השמירה נכשלה");
      dialogRef.current?.close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
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
      <form method="dialog" onSubmit={(e) => e.preventDefault()} dir="rtl">
        <div className="p-5 sm:p-7">
          <h2 id={titleId} className="font-display text-xl text-espresso mb-1">
            מי יכול לכתוב לבוט
          </h2>
          <p className="text-sm text-espresso-light leading-relaxed mb-5">
            לכל אדם שכותב לבוט יש שיחה נפרדת — אף אחד לא רואה את ההיסטוריה שלכם.
          </p>

          <div role="radiogroup" aria-labelledby={titleId} className="space-y-2">
            <AccessOption
              label="רק אני"
              hint="הבוט יענה רק להודעות מהמספר שלכם."
              checked={access === "owner"}
              disabled={saving}
              onSelect={() => setAccess("owner")}
            />
            <AccessOption
              label="כולם"
              hint="כל מי שכותב למספר של הבוט יקבל מענה."
              checked={access === "open"}
              disabled={saving}
              onSelect={() => setAccess("open")}
            />
          </div>

          {access === "owner" ? (
            <div className="mt-5 border-t border-sand-light/70 pt-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-espresso-light/70 mb-2">
                המספר שלכם
              </p>

              {owner ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span dir="ltr" className="font-mono text-sm text-espresso break-all">
                    {owner}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setOwner(null)}
                    className="py-1.5 text-sm text-espresso-light underline-offset-4 hover:text-espresso hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded disabled:opacity-60"
                  >
                    שינוי
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-espresso-light leading-relaxed">
                    שלחו הודעה כלשהי לבוט מהוואטסאפ שלכם והמספר יופיע כאן, או הקלידו אותו.
                  </p>

                  {pending.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {pending.map((sender) => (
                        <li
                          key={sender.number}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-light bg-cream px-4 py-3"
                        >
                          <div className="min-w-0">
                            <span dir="ltr" className="block font-mono text-sm text-espresso break-all">
                              {sender.number}
                            </span>
                            {sender.name ? (
                              <span className="block text-xs text-espresso-light mt-0.5 truncate">
                                {sender.name}
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setOwner(sender.number);
                              void save(sender.number);
                            }}
                            className="inline-flex items-center justify-center px-4 py-2.5 rounded-full bg-terra text-white text-sm font-medium hover:bg-terra-light transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-wait"
                          >
                            זה אני
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 flex items-center gap-2 text-sm text-espresso-light">
                      <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-terra animate-pulse" />
                      {pendingUnavailable
                        ? "לא הצלחנו לבדוק הודעות נכנסות כרגע."
                        : "ממתינים להודעה שלכם…"}
                    </p>
                  )}

                  <label htmlFor={phoneId} className="mt-4 block text-sm text-espresso-light mb-1.5">
                    או הקלידו את המספר
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
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setOwner(botNumber);
                      void save(botNumber);
                    }}
                    className="mt-3 py-1.5 text-sm text-espresso-light underline-offset-4 hover:text-espresso hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded disabled:opacity-60"
                  >
                    אני כותב לבוט מהמספר שלו עצמו
                  </button>
                </>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-5 pb-5 sm:px-7 sm:pb-6">
          <button
            type="button"
            onClick={() => {
              if (!saving) dialogRef.current?.close();
            }}
            disabled={saving}
            className="px-4 py-3 rounded-lg text-sm text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-3 rounded-lg text-sm font-medium bg-espresso text-cream hover:bg-espresso-light transition disabled:opacity-60 disabled:cursor-wait"
          >
            {saving ? "שומר…" : "שמירה"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function AccessOption({
  label,
  hint,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  hint: string;
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
      onClick={onSelect}
      className={`w-full text-start rounded-xl border px-4 py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60 ${
        checked
          ? "border-terra bg-terra-pale/50"
          : "border-sand-light hover:border-sand hover:bg-cream-dark/50"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            checked ? "border-terra" : "border-sand"
          }`}
        >
          {checked ? <span className="w-2 h-2 rounded-full bg-terra" /> : null}
        </span>
        <span className="font-medium text-espresso text-sm">{label}</span>
      </span>
      <span className="block mt-1 ps-[26px] text-xs text-espresso-light leading-relaxed">
        {hint}
      </span>
    </button>
  );
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

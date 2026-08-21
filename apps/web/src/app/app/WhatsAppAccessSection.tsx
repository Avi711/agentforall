"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WhatsappDmAccess } from "@/lib/orchestrator/types";
import type { WhatsappAccessSnapshot } from "@/lib/bots/snapshot";
import { readApiErrorMessage } from "@/lib/http/api-error";

const ACCESS_HINT =
  "קובע מי מקבל מענה בוואטסאפ. לא קשור למי הבעלים של הבוט — זה מוגדר ב״הזהות שלי״.";

export function accessLabel(access: WhatsappDmAccess, ownerNumber: string | null): string {
  if (access !== "owner") return "פתוח לכולם";
  return ownerNumber === null ? "רק אני — חסר מספר" : "רק אני";
}

export function WhatsAppAccessDialog({
  open,
  botId,
  initial,
  ownerNumber,
  onClose,
  onOpenIdentity,
}: {
  open: boolean;
  botId: string;
  initial: WhatsappAccessSnapshot;
  ownerNumber: string | null;
  onClose: () => void;
  onOpenIdentity: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [access, setAccess] = useState<WhatsappDmAccess>(initial.access);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setAccess(initial.access);
      setError(null);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, initial.access]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bot/${botId}/whatsapp/access`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access }),
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readApiErrorMessage(body) ?? "השמירה נכשלה");
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
            {ACCESS_HINT} לכל אדם שכותב לבוט יש שיחה נפרדת — אף אחד לא רואה את ההיסטוריה שלכם.
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

          {access === "owner" && ownerNumber === null ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-terra-light/30 bg-terra-pale/50 px-4 py-3">
              <p className="text-sm text-espresso leading-relaxed">
                כדי שהבוט יענה לכם, צריך להגדיר את המספר שלכם ב״הזהות שלי״.
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={onOpenIdentity}
                className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-sand text-espresso text-sm font-medium hover:bg-cream-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60"
              >
                להגדרת המספר
              </button>
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
            disabled={saving || access === initial.access}
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

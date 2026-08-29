"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DIALOG_ACTION } from "./action-buttons";

interface Props {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel,
  onClose,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setError(null);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        if (!busy) onClose();
      }}
      onClick={(e) => {
        // Backdrop = the dialog element itself; content sits in the inner <form>.
        if (e.target === dialogRef.current && !busy) dialogRef.current?.close();
      }}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 m-auto backdrop:bg-espresso/40 rounded-2xl p-0 w-[min(92vw,440px)] max-h-[85dvh] overflow-y-auto overscroll-contain border border-sand-light shadow-[0_20px_48px_rgba(44,24,16,0.18)]"
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()} dir="rtl">
        <div className="p-5 sm:p-7">
          <h2 id={titleId} className="font-display text-xl text-espresso mb-2">
            {title}
          </h2>
          <div id={descriptionId} className="text-sm text-espresso-light leading-relaxed">
            {description}
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-5 pb-5 sm:px-7 sm:pb-6">
          <button
            type="button"
            onClick={() => {
              if (!busy) dialogRef.current?.close();
            }}
            disabled={busy}
            className={DIALOG_ACTION.quiet}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={DIALOG_ACTION.primary}
          >
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
                />
                <span>{busyLabel}</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

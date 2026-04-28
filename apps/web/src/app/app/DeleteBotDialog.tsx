"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  botName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

// Typed-confirmation gate — user must type the bot name to enable confirm.
export function DeleteBotDialog({ open, botName, onClose, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setTyped("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0); // after render

    }
    if (!open && el.open) el.close();
  }, [open]);

  const matches = typed.trim() === botName.trim();

  async function handleConfirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
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
        // Backdrop = the dialog element itself; content sits in the inner <div>.
        if (e.target === dialogRef.current && !busy) dialogRef.current?.close();
      }}
      aria-labelledby="delete-bot-title"
      aria-describedby="delete-bot-description"
      className="fixed inset-0 m-auto backdrop:bg-espresso/40 rounded-2xl p-0 w-[min(92vw,440px)] max-h-[90vh] border border-sand-light shadow-[0_20px_48px_rgba(44,24,16,0.18)]"
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()} dir="rtl">
        <div className="p-6 sm:p-7">
          <h2
            id="delete-bot-title"
            className="font-display text-xl text-espresso mb-2"
          >
            מחיקת הבוט
          </h2>
          <p
            id="delete-bot-description"
            className="text-sm text-espresso-light leading-relaxed mb-4"
          >
            פעולה זו תמחק סופית את הסוכן{" "}
            <span className="font-medium text-espresso">{botName}</span>, את
            החיבור ל-WhatsApp, ואת כל ההגדרות. לא ניתן לשחזר.
          </p>

          <label className="block">
            <span className="block text-sm text-espresso-light mb-1.5">
              להאשרה, הקלידו את שם הבוט:
            </span>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              placeholder={botName}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg border border-sand bg-white text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale disabled:opacity-50"
            />
          </label>

          {error ? (
            <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 sm:px-7">
          <button
            type="button"
            onClick={() => {
              if (!busy) dialogRef.current?.close();
            }}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!matches || busy}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy ? (
              <>
                <Spinner />
                <span>מוחק…</span>
              </>
            ) : (
              "מחק לצמיתות"
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
    />
  );
}

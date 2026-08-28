"use client";

import { useEffect, useId, useRef } from "react";

// Equal weight on purpose: the user should weigh the choice, not follow a primary button.
export const CHOICE_BUTTON =
  "px-4 py-3 rounded-lg border border-sand text-sm font-medium text-espresso hover:border-terra hover:bg-terra-pale/40 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60 disabled:cursor-wait";

export function WhatsappNumberConfirmDialog({
  open,
  pending,
  onClose,
  onConfirm,
  onTelegram,
}: {
  open: boolean;
  pending: "pair" | "telegram" | null;
  onClose: () => void;
  onConfirm: () => void;
  // Omitted when Telegram is already connected: "אין לי" has nowhere useful to go.
  onTelegram?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop = the dialog element itself; content sits in the inner form.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="fixed inset-0 m-auto backdrop:bg-espresso/40 rounded-2xl p-0 w-[min(92vw,480px)] border border-sand-light shadow-[0_20px_48px_rgba(44,24,16,0.18)]"
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()} dir="rtl">
        <div className="rounded-t-2xl border-b-2 border-terra bg-terra-pale px-5 py-5 sm:px-7">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra text-base font-bold text-white"
            >
              !
            </span>
            <div>
              <h2 id={titleId} className="font-display text-xl text-espresso leading-snug">
                אל תחברו את הוואטסאפ האישי שלכם
              </h2>
              <p className="mt-1.5 text-sm font-semibold text-espresso leading-relaxed">
                וואטסאפ חוסמת מספרים שמריצים בוטים. הסוכן חייב מספר טלפון משלו.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-7">
          <p className="text-sm font-semibold text-espresso mb-2">מה צריך כדי לחבר וואטסאפ:</p>
          <ul className="space-y-1.5 list-disc ps-5 marker:text-terra text-sm text-espresso-light leading-relaxed">
            <li>מספר נפרד — eSIM ייעודית או סים משני (לא מספר וירטואלי חינמי; וואטסאפ חוסמת אותם)</li>
            <li>אפליקציית וואטסאפ מותקנת ופעילה על אותו מספר</li>
            <li>לא המספר שבו אתם מדברים עם המשפחה, הלקוחות או הבנק</li>
          </ul>
          <p className="mt-3 text-sm text-espresso-light">
            אין לכם עדיין מספר כזה?{" "}
            <a
              href="/blog/dedicated-whatsapp-number"
              target="_blank"
              rel="noopener"
              className="font-medium text-terra underline underline-offset-2 hover:text-terra-dark"
            >
              המדריך המלא לאייפון ולאנדרואיד
            </a>{" "}
            — eSIM, חשבון וואטסאפ שני וסריקת הקוד, צעד-צעד.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-5 pb-5 sm:px-7 sm:pb-6">
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending !== null}
            aria-busy={pending === "pair"}
            className={CHOICE_BUTTON}
          >
            {pending === "pair" ? "פותחים…" : "יש לי מספר ייעודי, נמשיך"}
          </button>
          {onTelegram ? (
            <button
              type="button"
              onClick={onTelegram}
              disabled={pending !== null}
              aria-busy={pending === "telegram"}
              className={CHOICE_BUTTON}
            >
              {pending === "telegram" ? "פותחים…" : "אין לי — נחבר טלגרם"}
            </button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}

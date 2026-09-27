"use client";

import { useEffect, useId, useRef } from "react";
import { ROW_ACTION_CLASS } from "./action-buttons";
import { BusyLabel, ChevronEnd, CloseButton, Spinner, TelegramGlyph, WhatsAppGlyph } from "./Marks";

const GUIDE_HREF = "/blog/dedicated-whatsapp-number";

const STEPS = [
  { title: "מספר טלפון נוסף", detail: "eSIM או סים שני" },
  { title: "חשבון וואטסאפ למספר הזה", detail: "אפשר באותו הטלפון, לצד הוואטסאפ האישי" },
  { title: "מחברים אליו את הסוכן", detail: "בשלב הבא, מהחשבון החדש" },
] as const;

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
  // Omitted when Telegram is already connected: the no-number way out has nowhere useful to go.
  onTelegram?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  // The dialog would otherwise focus its close button first; the title reads the question aloud instead.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      titleRef.current?.focus();
    }
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
      className="fixed inset-0 m-auto w-[min(92vw,440px)] rounded-3xl border border-sand-light p-0 shadow-[0_20px_48px_rgba(44,24,16,0.18)] backdrop:bg-espresso/40"
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()} dir="rtl">
        <div className="relative px-6 pb-6 pt-7 sm:px-7">
          <CloseButton onClick={() => dialogRef.current?.close()} className="absolute end-4 top-4" />
          <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-cream text-wa-green [&_svg]:h-7 [&_svg]:w-7">
            <WhatsAppGlyph />
          </span>
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="mt-4 font-display text-xl leading-snug text-espresso focus:outline-none">
            חברו את הסוכן לוואטסאפ נפרד
          </h2>
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-terra/20 bg-terra-pale px-3.5 py-2.5 text-sm leading-relaxed text-terra-dark">
            <WarningIcon />
            <span>
              <strong className="font-semibold">לא לוואטסאפ האישי שלכם.</strong> כך המספר האישי שלכם נשאר מוגן, והסוכן עובד על מספר משלו.{" "}
              <a href={GUIDE_HREF} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2 hover:text-espresso">
                למה?
              </a>
            </span>
          </p>

          <ol className="mt-5 flex flex-col gap-3.5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream text-sm font-semibold text-espresso tabular-nums">
                  {index + 1}
                </span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-medium text-espresso">{step.title}</span>
                  <span className="text-[13px] text-espresso-light">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          {/* Most people have no second number yet, so the guide leads and continuing takes a deliberate choice. */}
          <div className="mt-6 flex flex-col gap-2">
            <a href={GUIDE_HREF} target="_blank" rel="noopener" className={`${ROW_ACTION_CLASS.primary} w-full`}>
              איך משיגים מספר נוסף? מדריך עם תמונות
            </a>
            <button type="button" onClick={onConfirm} disabled={pending !== null} aria-busy={pending === "pair"} className={`${ROW_ACTION_CLASS.quiet} w-full`}>
              <BusyLabel busy={pending === "pair"} busyText="פותחים…">
                כבר יש לי וואטסאפ נפרד, נמשיך
              </BusyLabel>
            </button>
          </div>
        </div>

        {onTelegram ? (
          <button
            type="button"
            onClick={onTelegram}
            disabled={pending !== null}
            aria-busy={pending === "telegram"}
            className="flex w-full items-center gap-3 rounded-b-3xl border-t border-sand-light px-6 py-4 text-start transition hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra disabled:opacity-60 sm:px-7"
          >
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream text-telegram">
              <TelegramGlyph />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-sm font-semibold text-espresso">אפשר גם טלגרם</span>
              <span className="text-[13px] text-espresso-light">בלי מספר נוסף, בלחיצה אחת</span>
            </span>
            <span className="shrink-0 text-espresso-light">{pending === "telegram" ? <Spinner /> : <ChevronEnd />}</span>
          </button>
        ) : null}
      </form>
    </dialog>
  );
}

function WarningIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3.2 2.6 16.2h14.8z" />
      <path d="M10 8.2v3.6M10 14.1v.1" />
    </svg>
  );
}

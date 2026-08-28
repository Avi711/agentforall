"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { PendingLink, useNavigate } from "./Pending";
import { MonogramDisc } from "./Marks";

export function ConnectChannelStep({ name, onLater }: { name: string; onLater: () => void }) {
  const { navigating, navigate } = useNavigate();
  // `onLater` refreshes the dashboard; the transition keeps the button busy until the new card paints.
  const [skipping, startSkip] = useTransition();
  const [confirmWhatsapp, setConfirmWhatsapp] = useState(false);
  const [target, setTarget] = useState<"pair" | "telegram" | null>(null);
  const busy = navigating || skipping;

  function go(next: "pair" | "telegram") {
    setTarget(next);
    navigate(next === "pair" ? "/app/bot/pair" : "/app/bot/telegram");
  }

  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <div className="flex items-center gap-4">
        <MonogramDisc letter={name || "א"} size="lg" />
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-terra mb-1">הסוכן מוכן</p>
          <h3 className="font-display text-2xl text-espresso leading-tight">{name} כבר רץ</h3>
          <p className="mt-1 text-sm text-espresso-light">איפה תרצו לדבר איתו? אפשר לחבר את שניהם, עכשיו או אחר כך.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ChannelChoice
          href="/app/bot/telegram"
          title="טלגרם"
          badge="מומלץ"
          description="חיבור מיידי בשתי לחיצות — בלי מספר טלפון"
        />
        <ChannelChoice
          onClick={() => setConfirmWhatsapp(true)}
          title="וואטסאפ"
          description="דורש מספר ייעודי לסוכן — לא המספר האישי שלכם"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => startSkip(onLater)}
          disabled={busy}
          aria-busy={skipping}
          className="text-sm font-medium text-espresso-light hover:text-espresso transition disabled:opacity-50"
        >
          {skipping ? "רגע…" : "אחר כך"}
        </button>
      </div>

      <WhatsappNumberConfirmDialog
        open={confirmWhatsapp}
        pending={navigating ? target : null}
        onClose={() => setConfirmWhatsapp(false)}
        onConfirm={() => go("pair")}
        onTelegram={() => go("telegram")}
      />
    </div>
  );
}

// Equal weight on purpose: the user should weigh the choice, not follow a primary button.
const CHOICE_BUTTON =
  "px-4 py-3 rounded-lg border border-sand text-sm font-medium text-espresso hover:border-terra hover:bg-terra-pale/40 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60 disabled:cursor-wait";

function WhatsappNumberConfirmDialog({
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
  onTelegram: () => void;
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
            <li>מספר נפרד — eSIM ייעודית, סים משני או מספר וירטואלי</li>
            <li>אפליקציית וואטסאפ מותקנת ופעילה על אותו מספר</li>
            <li>לא המספר שבו אתם מדברים עם המשפחה, הלקוחות או הבנק</li>
          </ul>
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
          <button
            type="button"
            onClick={onTelegram}
            disabled={pending !== null}
            aria-busy={pending === "telegram"}
            className={CHOICE_BUTTON}
          >
            {pending === "telegram" ? "פותחים…" : "אין לי — נחבר טלגרם"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ChannelChoice({
  href,
  onClick,
  title,
  description,
  badge,
}: {
  href?: string;
  onClick?: () => void;
  title: string;
  description: string;
  badge?: string;
}) {
  const className =
    "flex flex-col gap-1 text-start rounded-2xl border border-sand bg-white px-4 py-3.5 transition hover:border-terra hover:bg-terra-pale/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-espresso">{title}</span>
        {badge ? (
          <span className="rounded-full bg-terra text-white text-[10px] font-medium px-2 py-0.5">{badge}</span>
        ) : null}
      </span>
      <span className="text-xs text-espresso-light leading-relaxed">{description}</span>
    </>
  );
  if (href) {
    return (
      <PendingLink href={href} className={className}>
        {body}
      </PendingLink>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

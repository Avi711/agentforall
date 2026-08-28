"use client";

import { useState, useTransition } from "react";
import { PendingLink, useNavigate } from "./Pending";
import { MonogramDisc } from "./Marks";
import { WhatsappNumberConfirmDialog } from "./WhatsappNumberDialog";

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

const CHOICE_LINK =
  "flex flex-col gap-1 text-start rounded-2xl border border-sand bg-white px-4 py-3.5 transition hover:border-terra hover:bg-terra-pale/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";

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
  const className = CHOICE_LINK;
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

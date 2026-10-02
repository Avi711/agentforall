"use client";

import { useState, useTransition } from "react";
import { ChannelOfferTile } from "./ChannelOfferTile";
import { useNavigate } from "./Pending";
import { BusyLabel, MonogramDisc, TelegramMark, WhatsAppMark } from "./Marks";
import { WhatsappNumberConfirmDialog } from "./WhatsappNumberDialog";

export function ConnectChannelStep({
  name,
  whatsappBusiness,
  onLater,
}: {
  name: string;
  whatsappBusiness: boolean;
  onLater: () => void;
}) {
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

      <div className="grid gap-2.5 sm:grid-cols-2">
        <ChannelOfferTile
          glyph={<TelegramMark />}
          name="טלגרם"
          featured
          offer="חיבור מיידי בשתי לחיצות — בלי מספר טלפון"
          target={{ kind: "link", label: "חיבור טלגרם", href: "/app/bot/telegram" }}
        />
        {whatsappBusiness ? (
          <ChannelOfferTile
            glyph={<WhatsAppMark business />}
            name="וואטסאפ עסקי"
            offer="מספר עסקי ללקוחות שלכם, דרך מטא"
            target={{ kind: "link", label: "חיבור וואטסאפ עסקי", href: "/app/bot/whatsapp-business" }}
          />
        ) : (
          <ChannelOfferTile
            glyph={<WhatsAppMark />}
            name="וואטסאפ"
            offer="דורש מספר ייעודי לסוכן — לא המספר האישי שלכם"
            target={{ kind: "button", label: "חיבור וואטסאפ", onClick: () => setConfirmWhatsapp(true) }}
          />
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => startSkip(onLater)}
          disabled={busy}
          aria-busy={skipping}
          className="text-sm font-medium text-espresso-light hover:text-espresso transition disabled:opacity-50"
        >
          <BusyLabel busy={skipping} busyText="רגע…">אחר כך</BusyLabel>
        </button>
      </div>

      {whatsappBusiness ? null : (
        <WhatsappNumberConfirmDialog
          open={confirmWhatsapp}
          pending={navigating ? target : null}
          onClose={() => setConfirmWhatsapp(false)}
          onConfirm={() => go("pair")}
          onTelegram={() => go("telegram")}
        />
      )}
    </div>
  );
}

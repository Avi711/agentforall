"use client";

import Link from "next/link";
import { MonogramDisc } from "./Marks";

export function ConnectChannelStep({ name, onLater }: { name: string; onLater: () => void }) {
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
        <ChannelLink
          href="/app/bot/telegram"
          title="טלגרם"
          badge="מומלץ"
          description="חיבור מיידי בשתי לחיצות — בלי מספר טלפון"
        />
        <ChannelLink
          href="/app/bot/pair"
          title="וואטסאפ"
          description="סריקת QR עם מספר ייעודי לסוכן"
        />
      </div>

      <p className="text-xs text-espresso-light leading-relaxed">
        <strong className="font-bold text-espresso">
          חשוב: אל תחברו לוואטסאפ את המספר האישי שלכם. וואטסאפ עלולה לחסום מספרים שמריצים בוטים,
          לכן צריך מספר נפרד (SIM נוסף או מספר וירטואלי).
        </strong>
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onLater}
          className="text-sm font-medium text-espresso-light hover:text-espresso transition"
        >
          אחר כך
        </button>
      </div>
    </div>
  );
}

function ChannelLink({
  href,
  title,
  description,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-2xl border border-sand bg-white px-4 py-3.5 transition hover:border-terra hover:bg-terra-pale/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra"
    >
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-espresso">{title}</span>
        {badge ? (
          <span className="rounded-full bg-terra text-white text-[10px] font-medium px-2 py-0.5">{badge}</span>
        ) : null}
      </span>
      <span className="text-xs text-espresso-light leading-relaxed">{description}</span>
    </Link>
  );
}

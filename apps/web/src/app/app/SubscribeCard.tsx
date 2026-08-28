"use client";

import { useState } from "react";
import { PendingLink } from "./Pending";
import type { BillingStatus } from "@/lib/billing/service";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { startCheckout } from "./billing/client";
import { SurfaceCard } from "./Marks";
import { PlanPicker } from "./PlanPicker";

const PERKS = [
  "סוכן AI פרטי משלכם, זמין 24/7 בוואטסאפ או בטלגרם",
  "זיכרון, תזכורות, יומן ומשימות — בעברית",
  "ביטול בכל רגע, בלי התחייבות",
];

export function SubscribeCard({ status }: { status: BillingStatus }) {
  const [plan, setPlan] = useState(status.plan.code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await startCheckout(plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setBusy(false);
    }
  }

  return (
    <SurfaceCard className="p-6 sm:p-10">
      <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">מנוי</p>
      <h2 className="font-display text-2xl sm:text-3xl text-espresso leading-tight mb-3">כדי להעלות סוכן צריך מנוי פעיל</h2>
      <ul className="space-y-2.5 mb-6">
        {PERKS.map((perk) => (
          <li key={perk} className="flex items-start gap-3 text-sm text-espresso">
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-terra shrink-0" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <div className="mb-6">
        <PlanPicker plans={status.plans} selected={plan} disabled={busy} onSelect={setPlan} />
      </div>

      {status.available ? (
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={busy}
          className="w-full sm:w-auto px-6 py-3.5 rounded-lg bg-terra text-white font-medium hover:bg-terra-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "מעבירים לתשלום…" : "הצטרפות למנוי"}
        </button>
      ) : (
        <p className="text-sm text-espresso-light">התשלומים ייפתחו בקרוב. נעדכן אתכם.</p>
      )}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}

      <p className="mt-6 text-xs text-espresso-light">
        כבר שילמתם?{" "}
        <PendingLink href="/app/settings" className="underline hover:text-terra">
          בדקו את מצב המנוי בהגדרות
        </PendingLink>
      </p>
    </SurfaceCard>
  );
}

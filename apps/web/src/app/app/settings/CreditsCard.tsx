"use client";

import { useState } from "react";
import type { CreditGrantView } from "@/lib/billing/credits/service";
import { formatCredits, formatDate, formatIls } from "@/lib/billing/format";
import { DEFAULT_TOPUP_PRESET_ILS, creditsForTopupIls, estimatedMessages } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { startTopup } from "../billing/client";

const GRANT_LABELS: Record<CreditGrantView["kind"], string> = {
  trial: "ניסיון",
  plan: "מנוי",
  topup: "טעינה",
};

export function CreditsCard({ status }: { status: BillingStatus }) {
  const [amount, setAmount] = useState(String(DEFAULT_TOPUP_PRESET_ILS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { credits, topup } = status;
  const canTopup = status.available && status.paid;
  const hasLedger = credits.grants.length > 0;
  const liveGrants = credits.grants.filter((g) => g.live);
  const parsed = parseWholeIls(amount);
  const validAmount = parsed !== null && parsed >= topup.minIls && parsed <= topup.maxIls;

  async function buy() {
    if (busy || parsed === null || !validAmount) return;
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await startTopup(parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setBusy(false);
    }
  }

  return (
    <section className="relative bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10 overflow-hidden">
      <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
      <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">קרדיטים</p>
      {hasLedger ? (
        <>
          <h2 className="font-display text-2xl text-espresso mb-1 leading-tight" dir="ltr">
            {formatCredits(credits.available)}
          </h2>
          <p className="text-sm text-espresso-light mb-6">
            זמינים · ≈ {formatCredits(estimatedMessages(credits.available))} הודעות
            {credits.stale ? " · הנתונים מהעדכון האחרון" : ""}
          </p>
        </>
      ) : (
        <p className="text-sm text-espresso-light mb-6">עדיין לא הופעלו קרדיטים בחשבון הזה.</p>
      )}

      {liveGrants.length > 0 ? (
        <dl className="divide-y divide-sand-light/70 mb-6">
          {liveGrants.map((grant) => (
            <div key={grant.id} className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <dt className="text-sm text-espresso">
                {GRANT_LABELS[grant.kind]}
                {grant.expiresAt ? <span className="text-xs text-espresso-light"> · עד {formatDate(grant.expiresAt)}</span> : null}
              </dt>
              <dd className="text-sm text-espresso tabular-nums" dir="ltr">
                {formatCredits(grant.credits - grant.usedCredits)} / {formatCredits(grant.credits)}
              </dd>
            </div>
          ))}
        </dl>
      ) : hasLedger ? (
        <p className="text-sm text-espresso-light mb-6">אין קרדיטים פעילים כרגע.</p>
      ) : null}

      {credits.lowBalance ? (
        <p role="status" className="mb-5 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-4">
          הקרדיטים עומדים להיגמר. כשהם נגמרים הסוכן מפסיק לענות עד הטעינה הבאה.
        </p>
      ) : null}

      {canTopup ? (
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-espresso-light/80 mb-3">טעינת קרדיטים</p>
          <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="סכומים מוכנים">
            {topup.presetsIls.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={busy}
                onClick={() => setAmount(String(preset))}
                aria-pressed={parsed === preset}
                className={`px-4 py-2 rounded-full border text-sm transition disabled:opacity-50 ${
                  parsed === preset ? "border-terra bg-terra/10 text-espresso" : "border-sand text-espresso-light hover:bg-cream-dark"
                }`}
              >
                {formatIls(preset)}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <label className="flex-1">
              <span className="block text-xs text-espresso-light mb-1">
                סכום אחר ({formatIls(topup.minIls)}–{formatIls(topup.maxIls)})
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={topup.minIls}
                max={topup.maxIls}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                dir="ltr"
                aria-invalid={!validAmount}
                aria-describedby="topup-amount-hint"
                className="w-full px-4 py-2.5 rounded-lg border border-sand bg-white text-espresso focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra/20 disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              onClick={buy}
              disabled={busy || !validAmount}
              className="px-5 py-3 rounded-lg bg-terra text-white font-medium hover:bg-terra-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy
                ? "מעבירים לתשלום…"
                : validAmount && parsed !== null
                  ? `טעינת ${formatCredits(creditsForTopupIls(parsed))} קרדיטים`
                  : "טעינה"}
            </button>
          </div>
          <p id="topup-amount-hint" className="mt-2 text-xs text-espresso-light">
            ₪1 = {topup.creditsPerIls} קרדיטים. הטעינה לא פגה ונשמרת גם אחרי חידוש המנוי.
          </p>
        </div>
      ) : (
        <p className="text-sm text-espresso-light">טעינת קרדיטים זמינה למנויים.</p>
      )}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function parseWholeIls(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

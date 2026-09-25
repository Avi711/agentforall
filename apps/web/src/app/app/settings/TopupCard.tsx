"use client";

import { useState } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PRIMARY_ACTION } from "@/components/pricing/styles";
import { formatCredits, formatIls } from "@/lib/billing/format";
import { DEFAULT_TOPUP_PRESET_ILS, creditsForTopupIls, type TopupTerms } from "@/lib/billing/pricing";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import { startTopup } from "../billing/client";
import { BusyLabel, SurfaceCard } from "../Marks";
import { useActionRunner } from "../useActionRunner";

const STEP_ILS = 10;

const RANGE =
  "h-2 w-full cursor-pointer appearance-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-4 disabled:cursor-not-allowed disabled:opacity-50 " +
  "[&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-terra [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(44,24,16,0.25)] " +
  "[&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-terra [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(44,24,16,0.25)]";

const QUICK_PICK = "min-h-10 rounded-full border px-4 text-sm font-semibold tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-50";

export function TopupCard({ terms }: { terms: TopupTerms }) {
  const [amount, setAmount] = useState(DEFAULT_TOPUP_PRESET_ILS);
  const topup = useActionRunner<"topup">();
  const busy = topup.pending !== null;
  const credits = creditsForTopupIls(amount);
  // The page is RTL, so the smallest amount sits on the right and the fill grows leftwards.
  const fill = `${((amount - terms.minIls) / (terms.maxIls - terms.minIls)) * 100}%`;

  return (
    <SurfaceCard id={SETTINGS_SECTION.topup} className="flex scroll-mt-24 flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-1.5">
        <h2 className="font-display text-2xl text-espresso">טעינת קרדיטים</h2>
        <p className="text-sm text-espresso-light">
          לחודש עמוס במיוחד: ₪1 = {terms.creditsPerIls} קרדיטים. קרדיטים שטוענים לא פגים ונשמרים גם אחרי החידוש.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <p className="flex flex-wrap items-baseline gap-x-3" aria-live="polite">
          <span className="text-4xl font-bold leading-none text-espresso tabular-nums">{formatIls(amount)}</span>
          <span className="text-base text-espresso-light">{formatCredits(credits)} קרדיטים שלא פגים</span>
        </p>
        <div className="flex flex-col gap-2">
          <input
            type="range"
            min={terms.minIls}
            max={terms.maxIls}
            step={STEP_ILS}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
            disabled={busy}
            aria-label="סכום הטעינה"
            aria-valuetext={`${formatIls(amount)}, ${formatCredits(credits)} קרדיטים`}
            className={RANGE}
            style={{ background: `linear-gradient(to left, var(--color-terra) ${fill}, var(--color-cream-dark) ${fill})` }}
          />
          <div className="flex justify-between text-xs text-espresso-light tabular-nums">
            <span>{formatIls(terms.minIls)}</span>
            <span>{formatIls(terms.maxIls)}</span>
          </div>
        </div>
        <div role="group" aria-label="סכומים נפוצים" className="flex flex-wrap gap-2">
          {terms.presetsIls.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={amount === preset}
              disabled={busy}
              onClick={() => setAmount(preset)}
              className={`${QUICK_PICK} ${amount === preset ? "border-terra bg-terra-pale text-terra-dark" : "border-sand-light bg-white text-espresso hover:bg-cream-dark"}`}
            >
              {formatIls(preset)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-cream p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <p className="text-[13px] text-espresso-light">חיוב חד־פעמי, כולל מע״מ</p>
        <button
          type="button"
          onClick={() => void topup.redirect("topup", () => startTopup(amount))}
          disabled={busy}
          aria-busy={busy}
          className={`${PRIMARY_ACTION} sm:px-6`}
        >
          <BusyLabel busy={busy} busyText="מעבירים לתשלום…">
            טעינה ב־{formatIls(amount)}
          </BusyLabel>
        </button>
      </div>

      <ErrorAlert>{topup.error}</ErrorAlert>
    </SurfaceCard>
  );
}

"use client";

import { useState } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/pricing/styles";
import { formatCredits, formatIls } from "@/lib/billing/format";
import { DEFAULT_TOPUP_PRESET_ILS, creditsForTopupIls, type TopupTerms } from "@/lib/billing/pricing";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import { startTopup } from "../billing/client";
import { BusyLabel, SurfaceCard } from "../Marks";
import { useActionRunner } from "../useActionRunner";

const STEP_ILS = 10;

const TILE =
  "flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-50";
const TILE_SELECTED = "border-terra bg-terra-pale ring-1 ring-terra";
const TILE_IDLE = "border-sand-light bg-white hover:border-sand hover:bg-cream";

const RANGE =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-4 disabled:cursor-not-allowed disabled:opacity-50 " +
  "[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-terra [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(44,24,16,0.25)] " +
  "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-terra [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(44,24,16,0.25)]";

export function TopupCard({ terms, urgent }: { terms: TopupTerms; urgent: boolean }) {
  const [amount, setAmount] = useState(DEFAULT_TOPUP_PRESET_ILS);
  const topup = useActionRunner<"topup">();
  const busy = topup.pending !== null;
  const custom = !terms.presetsIls.includes(amount);
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

      <div role="group" aria-label="סכום טעינה" className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {terms.presetsIls.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={amount === preset}
            disabled={busy}
            onClick={() => setAmount(preset)}
            className={`${TILE} ${amount === preset ? TILE_SELECTED : TILE_IDLE}`}
          >
            <span className="text-xl font-bold text-espresso tabular-nums">{formatIls(preset)}</span>
            <span className="text-xs text-espresso-light tabular-nums">{formatCredits(creditsForTopupIls(preset))} קרדיטים</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-espresso-light">או כל סכום אחר</span>
          <span className={`font-semibold tabular-nums ${custom ? "text-terra-dark" : "text-espresso-light"}`}>{formatIls(amount)}</span>
        </div>
        <input
          type="range"
          min={terms.minIls}
          max={terms.maxIls}
          step={STEP_ILS}
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          disabled={busy}
          aria-label="סכום טעינה אחר"
          aria-valuetext={`${formatIls(amount)}, ${formatCredits(creditsForTopupIls(amount))} קרדיטים`}
          className={RANGE}
          style={{ background: `linear-gradient(to left, var(--color-terra) ${fill}, var(--color-cream-dark) ${fill})` }}
        />
        <div className="flex justify-between text-xs text-espresso-light tabular-nums">
          <span>{formatIls(terms.minIls)}</span>
          <span>{formatIls(terms.maxIls)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-cream p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex flex-col gap-0.5" aria-live="polite">
          <p className="text-base font-semibold text-espresso tabular-nums">{formatCredits(creditsForTopupIls(amount))} קרדיטים שלא פגים</p>
          <p className="text-[13px] text-espresso-light">חיוב חד־פעמי, כולל מע״מ</p>
        </div>
        <button
          type="button"
          onClick={() => void topup.redirect("topup", () => startTopup(amount))}
          disabled={busy}
          aria-busy={busy}
          className={`${urgent ? PRIMARY_ACTION : SECONDARY_ACTION} sm:px-6`}
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

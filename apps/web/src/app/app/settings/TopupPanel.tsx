"use client";

import { useState } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { formatCredits, formatIls } from "@/lib/billing/format";
import { DEFAULT_TOPUP_PRESET_ILS, creditsForTopupIls, type TopupTerms } from "@/lib/billing/pricing";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import { ROW_ACTION_CLASS } from "../action-buttons";
import { startTopup } from "../billing/client";
import { BusyLabel, CloseButton } from "../Marks";
import { useActionRunner } from "../useActionRunner";
import { useHashTarget } from "../useHashTarget";
import { CardSection, SUBSECTION_TITLE } from "./Section";

const STEP_ILS = 10;

const TILE =
  "flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 disabled:opacity-50";
const TILE_SELECTED = "border-espresso bg-cream ring-1 ring-espresso";
const TILE_IDLE = "border-sand-light bg-white hover:border-sand hover:bg-cream";

const RANGE =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-4 disabled:cursor-not-allowed disabled:opacity-50 " +
  "[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-espresso [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(44,24,16,0.25)] " +
  "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-espresso [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(44,24,16,0.25)]";

export function TopupPanel({ terms, urgent }: { terms: TopupTerms; urgent: boolean }) {
  const targeted = useHashTarget(SETTINGS_SECTION.topup);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (urgent || targeted);
  const [amount, setAmount] = useState(DEFAULT_TOPUP_PRESET_ILS);
  const topup = useActionRunner<"topup">();
  const busy = topup.pending !== null;
  const custom = !terms.presetsIls.includes(amount);
  // The page is RTL, so the smallest amount sits on the right and the fill grows leftwards.
  const fill = `${((amount - terms.minIls) / (terms.maxIls - terms.minIls)) * 100}%`;

  return (
    <CardSection id={SETTINGS_SECTION.topup} labelledBy="topup-title">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 id="topup-title" className={SUBSECTION_TITLE}>
            טעינת קרדיטים
          </h3>
          <p className="text-[13px] text-espresso-light">לחודש עמוס במיוחד: ₪1 = {terms.creditsPerIls} קרדיטים, והם לא פגים.</p>
        </div>
        {open ? (
          <CloseButton onClick={() => setToggled(false)} />
        ) : (
          <button
            type="button"
            aria-expanded={false}
            aria-controls="topup-options"
            onClick={() => setToggled(true)}
            className={`${ROW_ACTION_CLASS.quiet} shrink-0`}
          >
            טעינה
          </button>
        )}
      </div>

      {open ? (
        <div id="topup-options" className="mt-6 flex flex-col gap-6">
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
              <span className={`tabular-nums ${custom ? "font-semibold text-espresso" : "text-espresso-light"}`}>{formatIls(amount)}</span>
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
              style={{ background: `linear-gradient(to left, var(--color-espresso) ${fill}, var(--color-cream-dark) ${fill})` }}
            />
            <div className="flex justify-between text-xs text-espresso-light tabular-nums">
              <span>{formatIls(terms.minIls)}</span>
              <span>{formatIls(terms.maxIls)}</span>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-espresso-light">קרדיטים שלא פגים. חיוב חד־פעמי, כולל מע״מ.</p>
            <button
              type="button"
              onClick={() => void topup.redirect("topup", () => startTopup(amount))}
              disabled={busy}
              aria-busy={busy}
              className={ROW_ACTION_CLASS.primary}
            >
              <BusyLabel busy={busy} busyText="מעבירים לתשלום…">
                הוספת {formatCredits(creditsForTopupIls(amount))} קרדיטים ב־{formatIls(amount)}
              </BusyLabel>
            </button>
          </div>

          <ErrorAlert>{topup.error}</ErrorAlert>
        </div>
      ) : null}
    </CardSection>
  );
}

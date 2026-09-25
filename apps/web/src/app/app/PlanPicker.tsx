"use client";

import type { KeyboardEvent } from "react";
import { formatCredits, formatIls, intervalAdjective, intervalWord } from "@/lib/billing/format";
import {
  BILLING_INTERVALS,
  PLANS,
  YEARLY_DISCOUNT_PERCENT,
  monthlyPriceIls,
  planFor,
  type BillingInterval,
  type Plan,
  type PlanCode,
} from "@/lib/billing/pricing";

function intervalOption(interval: BillingInterval): string {
  return interval === "year" ? `${intervalAdjective(interval)} · ${YEARLY_DISCOUNT_PERCENT}% הנחה` : intervalAdjective(interval);
}

export function PlanPicker({
  plans,
  selected,
  current,
  disabled = false,
  onSelect,
}: {
  plans: readonly Plan[];
  selected: PlanCode;
  current?: PlanCode;
  disabled?: boolean;
  onSelect: (code: PlanCode) => void;
}) {
  const { tier, interval } = PLANS[selected];
  const shown = plans.filter((plan) => plan.interval === interval);
  const selectable = shown.filter((plan) => plan.code !== current);
  const intervals = BILLING_INTERVALS.filter((option) => plans.some((plan) => plan.interval === option));

  function switchInterval(next: BillingInterval) {
    if (!disabled && next !== interval) onSelect(planFor(tier, next).code);
  }

  // Radio semantics: arrows move the selection, one tab stop for the whole group.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || selectable.length === 0) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = selectable.findIndex((plan) => plan.code === selected);
    const next = selectable[(index + step + selectable.length) % selectable.length];
    if (next) onSelect(next.code);
  }

  return (
    <div>
      {intervals.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="תדירות חיוב">
          {intervals.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => switchInterval(option)}
              aria-pressed={option === interval}
              className={`px-4 py-2 rounded-full border text-sm transition disabled:opacity-50 ${
                option === interval ? "border-terra bg-terra/10 text-espresso" : "border-sand text-espresso-light hover:bg-cream-dark"
              }`}
            >
              {intervalOption(option)}
            </button>
          ))}
        </div>
      ) : null}
      <div role="radiogroup" aria-label="תוכניות" onKeyDown={onKeyDown} className="grid gap-3 sm:grid-cols-3">
        {shown.map((plan) => {
          const isSelected = plan.code === selected;
          const isCurrent = plan.code === current;
          return (
            <button
              key={plan.code}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={disabled || isCurrent}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                if (!disabled && !isCurrent) onSelect(plan.code);
              }}
              className={`text-start rounded-2xl border p-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra ${
                isSelected ? "border-terra bg-terra/5 shadow-[0_0_0_1px_rgba(199,84,42,0.6)]" : "border-sand hover:bg-cream-dark/50"
              } ${isCurrent ? "opacity-60 cursor-default" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg text-espresso">{plan.name}</span>
                {isCurrent ? <span className="text-[11px] uppercase tracking-[0.16em] text-espresso-light">נוכחי</span> : null}
              </div>
              <p className="mt-1 text-2xl text-espresso tabular-nums" dir="ltr">
                {formatIls(monthlyPriceIls(plan))}
                <span className="text-xs text-espresso-light"> / חודש</span>
              </p>
              {plan.interval === "year" ? (
                <p className="text-xs text-espresso-light">{formatIls(plan.priceIls)} בחיוב שנתי</p>
              ) : null}
              <p className="mt-2 text-sm text-espresso">
                {formatCredits(plan.includedCredits)} קרדיטים ב{intervalWord(plan.interval)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

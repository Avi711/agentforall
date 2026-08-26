"use client";

import type { KeyboardEvent } from "react";
import { formatCredits, formatIls } from "@/lib/billing/format";
import { estimatedMessages, type Plan, type PlanCode } from "@/lib/billing/pricing";

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
  const selectable = plans.filter((plan) => plan.code !== current);

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
    <div role="radiogroup" aria-label="תוכניות" onKeyDown={onKeyDown} className="grid gap-3 sm:grid-cols-3">
      {plans.map((plan) => {
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
              {formatIls(plan.priceIls)}
              <span className="text-xs text-espresso-light"> / חודש</span>
            </p>
            <p className="mt-2 text-sm text-espresso">{formatCredits(plan.includedCredits)} קרדיטים בחודש</p>
            <p className="text-xs text-espresso-light">≈ {formatCredits(estimatedMessages(plan.includedCredits))} הודעות</p>
          </button>
        );
      })}
    </div>
  );
}

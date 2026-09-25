import { intervalAdjective } from "@/lib/billing/format";
import { BILLING_INTERVALS, YEARLY_DISCOUNT_PERCENT, type BillingInterval } from "@/lib/billing/pricing";

function optionLabel(interval: BillingInterval): string {
  const name = intervalAdjective(interval);
  return interval === "year" ? `${name} · ${YEARLY_DISCOUNT_PERCENT}% הנחה` : name;
}

export function BillingIntervalToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="תדירות חיוב" className="inline-flex gap-0.5 rounded-full border border-sand-light bg-white p-1">
      {BILLING_INTERVALS.map((interval) => {
        const active = interval === value;
        return (
          <button
            key={interval}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(interval)}
            className={`min-h-10 rounded-full px-5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-50 ${
              active ? "bg-espresso font-semibold text-cream" : "text-espresso-light hover:text-espresso"
            }`}
          >
            {optionLabel(interval)}
          </button>
        );
      })}
    </div>
  );
}

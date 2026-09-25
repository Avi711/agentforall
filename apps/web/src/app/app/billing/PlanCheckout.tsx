"use client";

import { PlanGrid } from "@/components/pricing/PlanGrid";
import type { BillingInterval, PlanCode } from "@/lib/billing/pricing";
import { BusyLabel } from "../Marks";

export function PlanCheckout({
  onChoose,
  pendingPlan,
  disabled,
  currentPlan = null,
  initialInterval,
}: {
  onChoose: (code: PlanCode) => void;
  pendingPlan: PlanCode | null;
  disabled: boolean;
  currentPlan?: PlanCode | null;
  initialInterval?: BillingInterval;
}) {
  return (
    <PlanGrid
      currentPlan={currentPlan}
      initialInterval={initialInterval}
      disabled={disabled}
      renderAction={(plan, { current, className }) => (
        <button
          type="button"
          disabled={disabled || current}
          aria-busy={pendingPlan === plan.code}
          onClick={() => onChoose(plan.code)}
          className={className}
        >
          <BusyLabel busy={pendingPlan === plan.code} busyText="מעבירים לתשלום…">
            {current ? "התוכנית הנוכחית" : `בחירה ב${plan.name}`}
          </BusyLabel>
        </button>
      )}
    />
  );
}

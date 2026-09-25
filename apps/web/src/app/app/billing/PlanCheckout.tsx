"use client";

import { PlanGrid } from "@/components/pricing/PlanGrid";
import type { PlanCode } from "@/lib/billing/pricing";
import { BusyLabel } from "../Marks";

export function PlanCheckout({
  onChoose,
  pendingPlan,
  disabled,
}: {
  onChoose: (code: PlanCode) => void;
  pendingPlan: PlanCode | null;
  disabled: boolean;
}) {
  return (
    <PlanGrid
      disabled={disabled}
      renderAction={(plan, { className }) => (
        <button
          type="button"
          disabled={disabled}
          aria-busy={pendingPlan === plan.code}
          onClick={() => onChoose(plan.code)}
          className={className}
        >
          <BusyLabel busy={pendingPlan === plan.code} busyText="מעבירים לתשלום…">
            בחירה ב{plan.name}
          </BusyLabel>
        </button>
      )}
    />
  );
}

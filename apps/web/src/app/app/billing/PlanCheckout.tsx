"use client";

import { PlanGrid } from "@/components/pricing/PlanGrid";
import { planLabel } from "@/lib/billing/format";
import { PLANS, type BillingInterval, type Plan, type PlanCode } from "@/lib/billing/pricing";
import { BusyLabel } from "../Marks";

const STATIC_ACTION = "flex min-h-12 w-full items-center justify-center text-sm font-semibold text-espresso-light";

export function PlanCheckout({
  onChoose,
  pendingPlan,
  disabled,
  currentPlan = null,
  scheduledPlan = null,
  initialInterval,
  busyText = "מעבירים לתשלום…",
}: {
  onChoose: (code: PlanCode) => void;
  pendingPlan: PlanCode | null;
  disabled: boolean;
  currentPlan?: PlanCode | null;
  scheduledPlan?: PlanCode | null;
  initialInterval?: BillingInterval;
  busyText?: string;
}) {
  return (
    <PlanGrid
      currentPlan={currentPlan}
      initialInterval={initialInterval}
      disabled={disabled}
      renderAction={(plan, { current, className }) =>
        current || plan.code === scheduledPlan ? (
          <p className={STATIC_ACTION}>{current ? "זו התוכנית שלכם" : "המעבר כבר נקבע"}</p>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-busy={pendingPlan === plan.code}
            onClick={() => onChoose(plan.code)}
            className={className}
          >
            <BusyLabel busy={pendingPlan === plan.code} busyText={busyText}>
              {actionLabel(plan, currentPlan)}
            </BusyLabel>
          </button>
        )
      }
    />
  );
}

function actionLabel(plan: Plan, currentPlan: PlanCode | null): string {
  if (!currentPlan) return `בחירה ב${plan.name}`;
  const from = PLANS[currentPlan];
  return from.interval === plan.interval && plan.priceIls > from.priceIls ? `שדרוג ל${plan.name}` : `מעבר ל${planLabel(plan)}`;
}

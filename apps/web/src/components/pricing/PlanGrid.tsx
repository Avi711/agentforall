"use client";

import { useState, type ReactNode } from "react";
import { PLAN_CATALOGUE, PLANS, isRecommendedPlan, type BillingInterval, type Plan, type PlanCode } from "@/lib/billing/pricing";
import { BillingIntervalToggle } from "./BillingIntervalToggle";
import { PlanCard } from "./PlanCard";
import { PRIMARY_ACTION, SECONDARY_ACTION, planActionClass } from "./styles";

// A subscriber is nudged one tier up, never towards a cheaper plan.
function nextTierUp(currentPlan: PlanCode): PlanCode | null {
  const current = PLANS[currentPlan];
  const higher = PLAN_CATALOGUE.filter((plan) => plan.interval === current.interval && plan.priceIls > current.priceIls);
  return higher.sort((a, b) => a.priceIls - b.priceIls)[0]?.code ?? null;
}

export interface PlanActionContext {
  current: boolean;
  className: string;
}

export function PlanGrid({
  renderAction,
  currentPlan = null,
  initialInterval = "month",
  align = "start",
  disabled = false,
}: {
  renderAction: (plan: Plan, context: PlanActionContext) => ReactNode;
  currentPlan?: PlanCode | null;
  initialInterval?: BillingInterval;
  align?: "start" | "center";
  disabled?: boolean;
}) {
  const [interval, setBillingInterval] = useState(initialInterval);
  const shown = PLAN_CATALOGUE.filter((plan) => plan.interval === interval);
  const upgrade = currentPlan ? nextTierUp(currentPlan) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className={`flex ${align === "center" ? "justify-center" : "justify-start"}`}>
        <BillingIntervalToggle value={interval} onChange={setBillingInterval} disabled={disabled} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 sm:items-stretch sm:gap-5 sm:pt-3">
        {shown.map((plan) => {
          const featured = currentPlan === null && isRecommendedPlan(plan);
          const current = plan.code === currentPlan;
          const actionClass = currentPlan === null ? planActionClass(plan) : plan.code === upgrade ? PRIMARY_ACTION : SECONDARY_ACTION;
          return (
            <PlanCard
              key={plan.code}
              plan={plan}
              featured={featured}
              label={current ? "התוכנית שלכם" : featured ? "מומלץ" : null}
              action={renderAction(plan, { current, className: actionClass })}
              className={featured ? "order-first sm:order-none" : ""}
            />
          );
        })}
      </div>
    </div>
  );
}

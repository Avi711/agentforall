"use client";

import { useState, type ReactNode } from "react";
import { PLAN_CATALOGUE, isRecommendedPlan, type BillingInterval, type Plan, type PlanCode } from "@/lib/billing/pricing";
import { BillingIntervalToggle } from "./BillingIntervalToggle";
import { PlanCard } from "./PlanCard";
import { planActionClass } from "./styles";

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

  return (
    <div className="flex flex-col gap-6">
      <div className={`flex ${align === "center" ? "justify-center" : "justify-start"}`}>
        <BillingIntervalToggle value={interval} onChange={setBillingInterval} disabled={disabled} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 sm:items-stretch sm:gap-5 sm:pt-3">
        {shown.map((plan) => {
          const featured = isRecommendedPlan(plan);
          const current = plan.code === currentPlan;
          return (
            <PlanCard
              key={plan.code}
              plan={plan}
              featured={featured}
              label={current ? "התוכנית שלכם" : featured ? "מומלץ" : null}
              action={renderAction(plan, { current, className: planActionClass(plan) })}
              className={featured ? "order-first sm:order-none" : ""}
            />
          );
        })}
      </div>
    </div>
  );
}

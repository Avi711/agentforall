"use client";

import { useState, type ReactNode } from "react";
import { PLAN_CATALOGUE, isRecommendedPlan, type BillingInterval, type Plan } from "@/lib/billing/pricing";
import { BillingIntervalToggle } from "./BillingIntervalToggle";
import { PlanCard } from "./PlanCard";
import { planActionClass } from "./styles";

export interface PlanActionContext {
  className: string;
}

export function PlanGrid({
  renderAction,
  align = "start",
  disabled = false,
}: {
  renderAction: (plan: Plan, context: PlanActionContext) => ReactNode;
  align?: "start" | "center";
  disabled?: boolean;
}) {
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const shown = PLAN_CATALOGUE.filter((plan) => plan.interval === interval);

  return (
    <div className="flex flex-col gap-6">
      <div className={`flex ${align === "center" ? "justify-center" : "justify-start"}`}>
        <BillingIntervalToggle value={interval} onChange={setBillingInterval} disabled={disabled} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 sm:items-stretch sm:gap-5 sm:pt-3">
        {shown.map((plan) => {
          const featured = isRecommendedPlan(plan);
          return (
            <PlanCard
              key={plan.code}
              plan={plan}
              featured={featured}
              label={featured ? "מומלץ" : null}
              action={renderAction(plan, { className: planActionClass(plan) })}
              className={featured ? "order-first sm:order-none" : ""}
            />
          );
        })}
      </div>
    </div>
  );
}

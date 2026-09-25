import type { ReactNode } from "react";
import { PLAN_COPY } from "@/content/plans.he";
import { formatCredits, formatIls, formatRatio } from "@/lib/billing/format";
import { PLANS, creditsRatio, monthlyCredits, monthlyPriceIls, yearlySavingsIls, type Plan } from "@/lib/billing/pricing";
import { CheckIcon } from "./CheckIcon";

export function PlanCard({
  plan,
  featured,
  label,
  action,
  className = "",
}: {
  plan: Plan;
  featured: boolean;
  label: string | null;
  action: ReactNode;
  className?: string;
}) {
  const copy = PLAN_COPY[plan.tier];
  const ratio = creditsRatio(plan, PLANS.basic);
  return (
    <article
      className={`flex flex-col gap-5 rounded-3xl bg-white p-6 sm:p-7 ${
        featured
          ? "border-2 border-terra shadow-[0_28px_50px_-30px_rgba(199,82,42,0.5)] sm:-translate-y-2.5"
          : "border border-sand-light"
      } ${className}`}
    >
      <header className="flex flex-col gap-1.5">
        <p className="h-4 text-xs font-bold text-terra">{label}</p>
        <h3 className="font-display text-2xl leading-tight text-espresso">{plan.name}</h3>
        <p className="text-sm text-espresso-light">{copy.tagline}</p>
      </header>

      <div className="flex flex-col gap-1.5">
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-bold leading-none tracking-tight text-espresso tabular-nums sm:text-[44px]">
            {formatIls(monthlyPriceIls(plan))}
          </span>
          <span className="text-sm text-espresso-light">לחודש</span>
        </p>
        {plan.interval === "year" ? (
          <p className="text-[13px] text-espresso-light">
            {formatIls(plan.priceIls)} בחיוב שנתי ·{" "}
            <span className="font-semibold text-sage-dark">חוסכים {formatIls(yearlySavingsIls(plan.tier))}</span>
          </p>
        ) : null}
      </div>

      <p className="flex items-baseline gap-1.5">
        <span className="text-lg font-bold text-espresso tabular-nums">{formatCredits(monthlyCredits(plan))}</span>
        <span className="text-sm text-espresso-light">
          קרדיטים בחודש{ratio > 1 ? ` · ${formatRatio(ratio)} מבסיסי` : ""}
        </span>
      </p>

      {action}

      <ul className="flex flex-col gap-3 border-t border-sand-light/70 pt-5 text-sm text-espresso">
        {copy.highlights.map((highlight) => (
          <li key={highlight} className="flex items-center gap-2.5">
            <CheckIcon />
            {highlight}
          </li>
        ))}
      </ul>
    </article>
  );
}

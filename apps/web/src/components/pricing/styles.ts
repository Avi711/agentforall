import { isRecommendedPlan, type Plan } from "@/lib/billing/pricing";

const ACTION_BASE =
  "pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const PRIMARY_ACTION = `${ACTION_BASE} bg-terra text-white shadow-[0_10px_24px_-12px_rgba(199,82,42,0.6)] hover:bg-terra-dark`;

export const SECONDARY_ACTION = `${ACTION_BASE} border border-espresso text-espresso hover:bg-cream-dark`;

export const DARK_ACTION = `${ACTION_BASE} bg-espresso px-6 text-cream hover:bg-espresso-light`;

export function planActionClass(plan: Plan): string {
  return isRecommendedPlan(plan) ? PRIMARY_ACTION : SECONDARY_ACTION;
}

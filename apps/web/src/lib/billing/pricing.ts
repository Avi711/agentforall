// Every price, rate, and allowance lives here; grace windows are in entitlement.ts.

// 1 credit = $0.005 of LiteLLM spend: a typical message is 1–4 credits, a typical month ~800.
export const USD_CENTS_PER_CREDIT = 0.5;

// Top-up price: ₪1 = 40 credits.
export const CREDITS_PER_ILS = 40;

export const PLAN_TIERS = ["basic", "standard", "pro"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const MONTHS_PER_INTERVAL: Record<BillingInterval, number> = { month: 1, year: 12 };

// Monthly codes predate yearly plans and are stored on live subscriptions; never rename them.
export const PLAN_CODES = ["basic", "standard", "pro", "basic_yearly", "standard_yearly", "pro_yearly"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const YEARLY_DISCOUNT_PERCENT = 10;

interface Tier {
  name: string;
  monthlyPriceIls: number;
  monthlyCredits: number;
}

const TIERS: Record<PlanTier, Tier> = {
  basic: { name: "בסיסי", monthlyPriceIls: 100, monthlyCredits: 2_500 },
  standard: { name: "סטנדרט", monthlyPriceIls: 200, monthlyCredits: 6_500 },
  pro: { name: "פרו", monthlyPriceIls: 400, monthlyCredits: 14_500 },
};

export interface Plan {
  code: PlanCode;
  tier: PlanTier;
  name: string;
  priceIls: number;
  currency: "ILS";
  interval: BillingInterval;
  // Granted with each paid period (a yearly plan gets the whole year up front); unused plan credits expire with it.
  includedCredits: number;
}

function buildPlan(tier: PlanTier, interval: BillingInterval): Plan {
  const { name, monthlyPriceIls, monthlyCredits } = TIERS[tier];
  const months = MONTHS_PER_INTERVAL[interval];
  const discountPercent = interval === "year" ? YEARLY_DISCOUNT_PERCENT : 0;
  return {
    code: planCodeOf(tier, interval),
    tier,
    name,
    priceIls: (monthlyPriceIls * months * (100 - discountPercent)) / 100,
    currency: "ILS",
    interval,
    includedCredits: monthlyCredits * months,
  };
}

export const PLANS: Record<PlanCode, Plan> = {
  basic: buildPlan("basic", "month"),
  standard: buildPlan("standard", "month"),
  pro: buildPlan("pro", "month"),
  basic_yearly: buildPlan("basic", "year"),
  standard_yearly: buildPlan("standard", "year"),
  pro_yearly: buildPlan("pro", "year"),
};

export const PLAN_CATALOGUE: readonly Plan[] = PLAN_CODES.map((code) => PLANS[code]);

export const DEFAULT_PLAN: PlanCode = "standard";

function planCodeOf(tier: PlanTier, interval: BillingInterval): PlanCode {
  return interval === "year" ? `${tier}_yearly` : tier;
}

export function planFor(tier: PlanTier, interval: BillingInterval): Plan {
  return PLANS[planCodeOf(tier, interval)];
}

export function monthlyPriceIls(plan: Plan): number {
  return plan.priceIls / MONTHS_PER_INTERVAL[plan.interval];
}

export const TRIAL_CREDITS = 400;
// Ceiling for a single admin top-up; larger amounts are a typo, not a policy.
export const ADMIN_GRANT_MAX_CREDITS = 50_000;
export const TRIAL_DAYS = 7;

// Any whole-shekel amount in range; the minimum keeps card-testing fraud out.
export const TOPUP_MIN_ILS = 20;
export const TOPUP_MAX_ILS = 500;
export const TOPUP_PRESETS_ILS = [50, 100, 200] as const;
export const DEFAULT_TOPUP_PRESET_ILS = 100;

export interface TopupTerms {
  minIls: number;
  maxIls: number;
  presetsIls: readonly number[];
  creditsPerIls: number;
}

export const TOPUP_TERMS: TopupTerms = {
  minIls: TOPUP_MIN_ILS,
  maxIls: TOPUP_MAX_ILS,
  presetsIls: TOPUP_PRESETS_ILS,
  creditsPerIls: CREDITS_PER_ILS,
};

// User-facing hint: a typical message costs about this many credits.
export const CREDITS_PER_MESSAGE_ESTIMATE = 2;

export function estimatedMessages(credits: number): number {
  return Math.floor(credits / CREDITS_PER_MESSAGE_ESTIMATE);
}

// Below this share of the current allowance the UI nudges toward a top-up.
export const LOW_BALANCE_RATIO = 0.2;

// Durable per-user cap on hosted checkout pages opened per hour.
export const MAX_OPEN_CHECKOUTS_PER_HOUR = 5;

export function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value);
}

export function findPlan(code: string | null): Plan | null {
  return code !== null && isPlanCode(code) ? PLANS[code] : null;
}

// Display only: a retired plan code on an old subscription still needs a name and price.
export function resolvePlan(code: string | null): Plan {
  return findPlan(code) ?? PLANS[DEFAULT_PLAN];
}

export function planAmountAgorot(plan: Plan): number {
  return agorotFromIls(plan.priceIls);
}

export function creditsFromUsdCents(cents: number): number {
  return Math.ceil(cents / USD_CENTS_PER_CREDIT);
}

export function usdCentsFromCredits(credits: number): number {
  return Math.floor(credits * USD_CENTS_PER_CREDIT);
}

export function agorotFromIls(ils: number): number {
  return Math.round(ils * 100);
}

export function ilsFromAgorot(agorot: number): number {
  return agorot / 100;
}

export function isValidTopupAmountIls(value: number): boolean {
  return Number.isInteger(value) && value >= TOPUP_MIN_ILS && value <= TOPUP_MAX_ILS;
}

export function creditsForTopupIls(ils: number): number {
  return Math.floor(ils * CREDITS_PER_ILS);
}

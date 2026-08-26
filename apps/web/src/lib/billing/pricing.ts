// Every price, rate, and allowance lives here; grace windows are in entitlement.ts.

// 1 credit = $0.005 of LiteLLM spend: a typical message is 1–4 credits, a typical month ~800.
export const USD_CENTS_PER_CREDIT = 0.5;

// Top-up price: ₪1 = 20 credits.
export const AGOROT_PER_CREDIT = 5;

export const PLAN_CODES = ["basic", "standard", "pro"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export type BillingInterval = "month";

export interface Plan {
  code: PlanCode;
  name: string;
  priceIls: number;
  currency: "ILS";
  interval: BillingInterval;
  // Included with each paid period; unused plan credits expire with the period.
  includedCredits: number;
}

export const PLANS: Record<PlanCode, Plan> = {
  basic: { code: "basic", name: "בסיסי", priceIls: 100, currency: "ILS", interval: "month", includedCredits: 1_000 },
  standard: { code: "standard", name: "סטנדרט", priceIls: 200, currency: "ILS", interval: "month", includedCredits: 2_500 },
  pro: { code: "pro", name: "פרו", priceIls: 400, currency: "ILS", interval: "month", includedCredits: 6_000 },
};

export const PLAN_CATALOGUE: readonly Plan[] = PLAN_CODES.map((code) => PLANS[code]);

export const DEFAULT_PLAN: PlanCode = "standard";

export const TRIAL_CREDITS = 400;
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
  creditsPerIls: 100 / AGOROT_PER_CREDIT,
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
  return Math.floor(agorotFromIls(ils) / AGOROT_PER_CREDIT);
}

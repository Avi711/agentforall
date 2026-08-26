import type { TrialState } from "./credits/service";
import { DAY_MS } from "./dates";
import type { Subscription } from "./domain";

export type EntitlementReason =
  | "subscription_active"
  | "subscription_trial"
  | "grace_period"
  | "canceled_until_period_end"
  | "trial"
  | "trial_available"
  | "beta_access"
  | "enforcement_disabled"
  | "no_subscription"
  | "subscription_inactive";

export interface Entitlement {
  entitled: boolean;
  reason: EntitlementReason;
}

export interface EntitlementInput {
  subscription: Subscription | null;
  trial: TrialState;
  betaAccess: boolean;
  enforcement: boolean;
  now: Date;
}

// Covers callback latency on renewal day; a charge-driven provider never sends "expired".
export const ACTIVE_GRACE_MS = 3 * DAY_MS;
// Dunning window after a failed charge before access stops.
export const PAST_DUE_GRACE_MS = 7 * DAY_MS;

const INACTIVE: Entitlement = { entitled: false, reason: "subscription_inactive" };

// Subscription state alone — what the paid relationship grants, ignoring trials and overrides.
export function evaluateSubscription(subscription: Subscription | null, now: Date): Entitlement {
  if (!subscription) return { entitled: false, reason: "no_subscription" };
  const end = subscription.currentPeriodEnd;
  switch (subscription.status) {
    case "trialing":
      return withinPeriod(end, now, ACTIVE_GRACE_MS) ? { entitled: true, reason: "subscription_trial" } : INACTIVE;
    case "active":
      return withinPeriod(end, now, ACTIVE_GRACE_MS) ? { entitled: true, reason: "subscription_active" } : INACTIVE;
    case "past_due":
      return withinPeriod(end, now, PAST_DUE_GRACE_MS) ? { entitled: true, reason: "grace_period" } : INACTIVE;
    case "canceled":
      // A cancellation with no known end date means access ended; null is not "open-ended" here.
      return end !== null && withinPeriod(end, now, 0) ? { entitled: true, reason: "canceled_until_period_end" } : INACTIVE;
    case "paused":
    case "unpaid":
    case "expired":
      return INACTIVE;
  }
}

// Paid state wins so a paying user always reads as paid; trial, then overrides, only rescue a non-entitled one.
export function computeEntitlement(input: EntitlementInput): Entitlement {
  const fromSubscription = evaluateSubscription(input.subscription, input.now);
  if (fromSubscription.entitled) return fromSubscription;
  if (input.trial.kind === "active") return { entitled: true, reason: "trial" };
  if (input.trial.kind === "available") return { entitled: true, reason: "trial_available" };
  if (input.betaAccess) return { entitled: true, reason: "beta_access" };
  if (!input.enforcement) return { entitled: true, reason: "enforcement_disabled" };
  return fromSubscription;
}

export function isPaidReason(reason: EntitlementReason): boolean {
  switch (reason) {
    case "subscription_active":
    case "subscription_trial":
    case "grace_period":
    case "canceled_until_period_end":
      return true;
    case "trial":
    case "trial_available":
    case "beta_access":
    case "enforcement_disabled":
    case "no_subscription":
    case "subscription_inactive":
      return false;
  }
}

// A null period end means the provider owns the lifecycle and reports lapses itself.
function withinPeriod(end: Date | null, now: Date, graceMs: number): boolean {
  return end === null || now.getTime() < end.getTime() + graceMs;
}

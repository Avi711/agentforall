import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_GRACE_MS,
  PAST_DUE_GRACE_MS,
  computeEntitlement,
  evaluateSubscription,
  isPaidReason,
  type EntitlementInput,
  type EntitlementReason,
} from "../../src/lib/billing/entitlement";
import type { Subscription } from "../../src/lib/billing/domain";
import { NOW, subscription } from "./fakes";

const HOUR_MS = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const USED: EntitlementInput["trial"] = { kind: "used" };

const cases: Array<{ name: string; sub: Partial<Subscription>; entitled: boolean; reason: EntitlementReason }> = [
  { name: "active within period", sub: { status: "active" }, entitled: true, reason: "subscription_active" },
  { name: "active inside renewal grace", sub: { status: "active", currentPeriodEnd: at(-HOUR_MS) }, entitled: true, reason: "subscription_active" },
  { name: "active past renewal grace", sub: { status: "active", currentPeriodEnd: at(-ACTIVE_GRACE_MS - 1) }, entitled: false, reason: "subscription_inactive" },
  { name: "active with provider-owned lifecycle (no period end)", sub: { status: "active", currentPeriodEnd: null }, entitled: true, reason: "subscription_active" },
  { name: "trialing", sub: { status: "trialing" }, entitled: true, reason: "subscription_trial" },
  { name: "past_due inside dunning window", sub: { status: "past_due", currentPeriodEnd: at(-PAST_DUE_GRACE_MS + HOUR_MS) }, entitled: true, reason: "grace_period" },
  { name: "past_due after dunning window", sub: { status: "past_due", currentPeriodEnd: at(-PAST_DUE_GRACE_MS - 1) }, entitled: false, reason: "subscription_inactive" },
  { name: "past_due with provider-owned lifecycle stays in grace until the provider says otherwise", sub: { status: "past_due", currentPeriodEnd: null }, entitled: true, reason: "grace_period" },
  { name: "canceled before period end", sub: { status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(HOUR_MS) }, entitled: true, reason: "canceled_until_period_end" },
  { name: "canceled at period end gets no grace", sub: { status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: NOW }, entitled: false, reason: "subscription_inactive" },
  { name: "canceled without a period end", sub: { status: "canceled", currentPeriodEnd: null }, entitled: false, reason: "subscription_inactive" },
  { name: "paused", sub: { status: "paused" }, entitled: false, reason: "subscription_inactive" },
  { name: "unpaid", sub: { status: "unpaid" }, entitled: false, reason: "subscription_inactive" },
  { name: "expired", sub: { status: "expired" }, entitled: false, reason: "subscription_inactive" },
];

for (const c of cases) {
  test(`evaluateSubscription: ${c.name}`, () => {
    assert.deepEqual(evaluateSubscription(subscription(c.sub), NOW), { entitled: c.entitled, reason: c.reason });
  });
}

test("evaluateSubscription: no subscription", () => {
  assert.deepEqual(evaluateSubscription(null, NOW), { entitled: false, reason: "no_subscription" });
});

test("computeEntitlement: paid state outranks trial and local overrides", () => {
  const result = computeEntitlement({
    subscription: subscription(),
    trial: { kind: "active", expiresAt: at(HOUR_MS).toISOString(), remainingCredits: 10 },
    betaAccess: true,
    enforcement: false,
    now: NOW,
  });
  assert.equal(result.reason, "subscription_active");
});

test("computeEntitlement: trial states, beta access, and enforcement rescue in that order", () => {
  const base = { subscription: null, betaAccess: false, enforcement: true, now: NOW };
  assert.deepEqual(computeEntitlement({ ...base, trial: { kind: "active", expiresAt: at(HOUR_MS).toISOString(), remainingCredits: 10 } }), { entitled: true, reason: "trial" });
  assert.deepEqual(computeEntitlement({ ...base, trial: { kind: "available" } }), { entitled: true, reason: "trial_available" });
  assert.deepEqual(computeEntitlement({ ...base, trial: USED }), { entitled: false, reason: "no_subscription" });
  assert.deepEqual(computeEntitlement({ ...base, trial: USED, betaAccess: true }), { entitled: true, reason: "beta_access" });
  assert.deepEqual(computeEntitlement({ ...base, trial: USED, enforcement: false }), { entitled: true, reason: "enforcement_disabled" });
  assert.deepEqual(computeEntitlement({ ...base, trial: USED, subscription: subscription({ status: "expired" }) }), { entitled: false, reason: "subscription_inactive" });
});

test("isPaidReason: only subscription-backed access counts as paid", () => {
  const paid: EntitlementReason[] = ["subscription_active", "subscription_trial", "grace_period", "canceled_until_period_end"];
  const unpaid: EntitlementReason[] = ["trial", "trial_available", "beta_access", "enforcement_disabled", "no_subscription", "subscription_inactive"];
  for (const reason of paid) assert.equal(isPaidReason(reason), true, reason);
  for (const reason of unpaid) assert.equal(isPaidReason(reason), false, reason);
});

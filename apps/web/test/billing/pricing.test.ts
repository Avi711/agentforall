import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGOROT_PER_CREDIT,
  DEFAULT_PLAN,
  PLANS,
  PLAN_CATALOGUE,
  TOPUP_PRESETS_ILS,
  TOPUP_TERMS,
  agorotFromIls,
  creditsForTopupIls,
  creditsFromUsdCents,
  findPlan,
  ilsFromAgorot,
  isValidTopupAmountIls,
  planAmountAgorot,
  resolvePlan,
  usdCentsFromCredits,
} from "../../src/lib/billing/pricing";

test("credits ↔ usd cents: consumption rounds up, ceilings round down, so a user is never over-capped", () => {
  assert.equal(creditsFromUsdCents(0), 0);
  assert.equal(creditsFromUsdCents(1), 2);
  assert.equal(creditsFromUsdCents(391), 782);
  assert.equal(usdCentsFromCredits(1), 0);
  assert.equal(usdCentsFromCredits(2), 1);
  assert.equal(usdCentsFromCredits(2500), 1250);
  assert.ok(usdCentsFromCredits(creditsFromUsdCents(391)) <= 391);
});

test("shekel conversions are exact integers", () => {
  assert.equal(agorotFromIls(199), 19900);
  assert.equal(ilsFromAgorot(19900), 199);
  assert.equal(planAmountAgorot(PLANS.standard), 20000);
});

test("top-up terms are derived from the single agorot-per-credit rate", () => {
  assert.equal(TOPUP_TERMS.creditsPerIls, creditsForTopupIls(1));
  assert.equal(creditsForTopupIls(50), 5000 / AGOROT_PER_CREDIT);
  assert.deepEqual(TOPUP_TERMS.presetsIls, TOPUP_PRESETS_ILS);
  for (const preset of TOPUP_PRESETS_ILS) assert.equal(isValidTopupAmountIls(preset), true);
  assert.equal(isValidTopupAmountIls(TOPUP_TERMS.minIls - 1), false);
  assert.equal(isValidTopupAmountIls(TOPUP_TERMS.maxIls + 1), false);
  assert.equal(isValidTopupAmountIls(50.5), false);
});

test("plan catalogue is ordered by price, default is a real plan, unknown codes resolve only for display", () => {
  const prices = PLAN_CATALOGUE.map((p) => p.priceIls);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(findPlan(DEFAULT_PLAN)?.code, DEFAULT_PLAN);
  assert.equal(findPlan("gold"), null);
  assert.equal(findPlan(null), null);
  assert.equal(resolvePlan("gold").code, DEFAULT_PLAN);
  assert.equal(resolvePlan("pro").code, "pro");
});

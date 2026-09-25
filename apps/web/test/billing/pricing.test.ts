import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CREDITS_PER_ILS,
  DEFAULT_PLAN,
  PLANS,
  PLAN_CATALOGUE,
  PLAN_TIERS,
  TOPUP_PRESETS_ILS,
  TOPUP_TERMS,
  YEARLY_DISCOUNT_PERCENT,
  agorotFromIls,
  creditsForTopupIls,
  creditsRatio,
  creditsFromUsdCents,
  findPlan,
  ilsFromAgorot,
  isRecommendedPlan,
  isValidTopupAmountIls,
  monthlyCredits,
  monthlyPriceIls,
  planAmountAgorot,
  planFor,
  resolvePlan,
  usdCentsFromCredits,
  yearlySavingsIls,
} from "../../src/lib/billing/pricing";
import { formatAgorot, formatRatio } from "../../src/lib/billing/format";

test("plans compare per month: a yearly plan's monthly credits, its savings in shekels, and its size against Basic", () => {
  assert.equal(monthlyCredits(PLANS.standard_yearly), monthlyCredits(PLANS.standard));
  assert.equal(yearlySavingsIls("standard"), PLANS.standard.priceIls * 12 - PLANS.standard_yearly.priceIls);
  assert.equal(yearlySavingsIls("pro"), 480);
  assert.equal(creditsRatio(PLANS.pro_yearly, PLANS.basic), creditsRatio(PLANS.pro, PLANS.basic));
  assert.equal(formatRatio(creditsRatio(PLANS.standard, PLANS.basic)), "פי 2.6");
  assert.deepEqual(PLAN_CATALOGUE.filter(isRecommendedPlan).map((p) => p.tier), [PLANS[DEFAULT_PLAN].tier, PLANS[DEFAULT_PLAN].tier]);
});

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

test("top-up terms are derived from the single credits-per-shekel rate", () => {
  assert.equal(TOPUP_TERMS.creditsPerIls, creditsForTopupIls(1));
  assert.equal(creditsForTopupIls(50), 50 * CREDITS_PER_ILS);
  assert.deepEqual(TOPUP_TERMS.presetsIls, TOPUP_PRESETS_ILS);
  for (const preset of TOPUP_PRESETS_ILS) assert.equal(isValidTopupAmountIls(preset), true);
  assert.equal(isValidTopupAmountIls(TOPUP_TERMS.minIls - 1), false);
  assert.equal(isValidTopupAmountIls(TOPUP_TERMS.maxIls + 1), false);
  assert.equal(isValidTopupAmountIls(50.5), false);
});

test("plan catalogue is ordered by price within each interval, default is a real plan, unknown codes resolve only for display", () => {
  for (const interval of ["month", "year"] as const) {
    const prices = PLAN_CATALOGUE.filter((p) => p.interval === interval).map((p) => p.priceIls);
    assert.equal(prices.length, PLAN_TIERS.length);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  }
  assert.equal(findPlan(DEFAULT_PLAN)?.code, DEFAULT_PLAN);
  assert.equal(findPlan("gold"), null);
  assert.equal(findPlan(null), null);
  assert.equal(resolvePlan("gold").code, DEFAULT_PLAN);
  assert.equal(resolvePlan("pro").code, "pro");
});

test("a yearly plan is twelve months of the monthly plan, discounted, with the whole year's credits up front", () => {
  for (const tier of PLAN_TIERS) {
    const month = planFor(tier, "month");
    const year = planFor(tier, "year");
    assert.deepEqual([month.tier, month.interval, year.tier, year.interval], [tier, "month", tier, "year"]);
    assert.equal(year.priceIls, (month.priceIls * 12 * (100 - YEARLY_DISCOUNT_PERCENT)) / 100);
    assert.ok(Number.isInteger(year.priceIls));
    assert.equal(year.includedCredits, month.includedCredits * 12);
    assert.ok(monthlyPriceIls(year) < monthlyPriceIls(month));
  }
  assert.deepEqual([PLANS.basic_yearly.priceIls, PLANS.standard_yearly.priceIls, PLANS.pro_yearly.priceIls], [1080, 2160, 4320]);
  for (const [code, plan] of Object.entries(PLANS)) assert.equal(plan.code, code);
});

test("a charge shows to the agora, a whole amount stays short", () => {
  assert.deepEqual([formatAgorot(29991), formatAgorot(40000), formatAgorot(5)], ["₪299.91", "₪400", "₪0.05"]);
});

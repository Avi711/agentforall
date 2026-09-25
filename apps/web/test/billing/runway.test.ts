import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS } from "../../src/lib/billing/dates";
import { ACTIVE_GRACE_MS } from "../../src/lib/billing/entitlement";
import { creditPace } from "../../src/lib/billing/credits/runway";
import { NOW, grant } from "./fakes";

const daysAfter = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

test("a pace that empties the balance before the period ends says how many days are left", () => {
  const trial = grant({ kind: "trial", credits: 400, usedCredits: 140, expiresAt: daysAfter(7) });
  assert.deepEqual(creditPace([trial], 260, daysAfter(2)), { kind: "short", days: 3 });
});

test("a pace that reaches the period end says it lasts until then, the plan's grace left out", () => {
  const slow = grant({ credits: 2500, usedCredits: 100, expiresAt: daysAfter(30) });
  const periodEnd = new Date(daysAfter(30).getTime() - ACTIVE_GRACE_MS).toISOString();
  assert.deepEqual(creditPace([slow], 2400, daysAfter(10)), { kind: "lasts", until: periodEnd });
});

test("no estimate before a day of pace or without any spend", () => {
  const fresh = grant({ usedCredits: 50, expiresAt: daysAfter(30) });
  assert.deepEqual(creditPace([fresh], 950, daysAfter(0.5)), { kind: "unknown" });
  assert.deepEqual(creditPace([grant({ expiresAt: daysAfter(30) })], 1000, daysAfter(3)), { kind: "unknown" });
});

test("nothing to estimate once the balance is gone or the period grant is used up", () => {
  const spent = grant({ credits: 400, usedCredits: 400, kind: "trial", expiresAt: daysAfter(5) });
  assert.deepEqual(creditPace([spent], 0, daysAfter(2)), { kind: "unknown" });
  const topup = grant({ kind: "topup", credits: 4000, usedCredits: 1000, grantedAt: daysAfter(-1), expiresAt: null });
  assert.deepEqual(creditPace([spent, topup], 3000, daysAfter(2)), { kind: "unknown" });
});

test("pace follows the newest trial or plan grant, never a top-up", () => {
  const oldPlan = grant({ usedCredits: 1000, grantedAt: daysAfter(-40), expiresAt: daysAfter(-10) });
  const plan = grant({ credits: 2500, usedCredits: 1000, grantedAt: NOW, expiresAt: daysAfter(30) });
  const topup = grant({ kind: "topup", credits: 4000, usedCredits: 4000, grantedAt: daysAfter(-60), expiresAt: null });
  assert.deepEqual(creditPace([oldPlan, plan, topup], 1500, daysAfter(10)), { kind: "short", days: 15 });
  assert.deepEqual(creditPace([topup], 1500, daysAfter(10)), { kind: "unknown" });
});

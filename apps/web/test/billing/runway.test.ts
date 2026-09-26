import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS } from "../../src/lib/billing/dates";
import { ACTIVE_GRACE_MS } from "../../src/lib/billing/entitlement";
import { runwayDays } from "../../src/lib/billing/credits/runway";
import { NOW, grant } from "./fakes";

const daysAfter = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
const planEndingIn = (days: number) => daysAfter(days + ACTIVE_GRACE_MS / DAY_MS);

test("the balance lasts as long as the current grant's pace allows", () => {
  const trial = grant({ kind: "trial", credits: 400, usedCredits: 140, expiresAt: daysAfter(7) });
  assert.equal(runwayDays([trial], 260, daysAfter(2)), 3);
});

test("no estimate before a day of pace, without any spend, or when the balance reaches the period end", () => {
  const fresh = grant({ usedCredits: 50, expiresAt: planEndingIn(30) });
  assert.equal(runwayDays([fresh], 950, daysAfter(0.5)), null);
  assert.equal(runwayDays([grant({ expiresAt: planEndingIn(30) })], 1000, daysAfter(3)), null);
  const slow = grant({ credits: 2500, usedCredits: 100, expiresAt: planEndingIn(30) });
  assert.equal(runwayDays([slow], 2400, daysAfter(10)), null);
});

test("nothing to estimate once the balance is gone, the period grant is used up, or the period has ended", () => {
  const spent = grant({ credits: 400, usedCredits: 400, kind: "trial", expiresAt: daysAfter(5) });
  assert.equal(runwayDays([spent], 0, daysAfter(2)), null);
  const topup = grant({ kind: "topup", credits: 4000, usedCredits: 1000, grantedAt: daysAfter(-1), expiresAt: null });
  assert.equal(runwayDays([spent, topup], 3000, daysAfter(2)), null);
  const ended = grant({ credits: 2500, usedCredits: 2400, grantedAt: daysAfter(-30), expiresAt: planEndingIn(0) });
  assert.equal(runwayDays([ended], 100, daysAfter(1)), null);
});

test("pace follows the newest trial or plan grant, never a top-up", () => {
  const oldPlan = grant({ usedCredits: 1000, grantedAt: daysAfter(-40), expiresAt: daysAfter(-10) });
  const plan = grant({ credits: 2500, usedCredits: 1000, grantedAt: NOW, expiresAt: planEndingIn(30) });
  const topup = grant({ kind: "topup", credits: 4000, usedCredits: 4000, grantedAt: daysAfter(-60), expiresAt: null });
  assert.equal(runwayDays([oldPlan, plan, topup], 1500, daysAfter(10)), 15);
  assert.equal(runwayDays([topup], 1500, daysAfter(10)), null);
});

test("a leftover spent before the new period's grant never raises a false alarm", () => {
  const leftover = grant({ credits: 2500, usedCredits: 2150, grantedAt: daysAfter(-30), expiresAt: planEndingIn(0) });
  const renewal = grant({ credits: 2500, usedCredits: 0, grantedAt: NOW, expiresAt: planEndingIn(30) });
  assert.equal(runwayDays([leftover, renewal], 2850, daysAfter(2)), null);
  assert.equal(runwayDays([{ ...renewal, usedCredits: 350 }], 2150, daysAfter(14)), null);
});

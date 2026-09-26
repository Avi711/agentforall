import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreditGrantView } from "../../src/lib/billing/credits/service";
import { balancePools } from "../../src/lib/billing/credits/pools";

const PERIOD_END = "2026-10-25T10:00:00.000Z";

const view = (overrides: Partial<CreditGrantView>): CreditGrantView => ({
  id: "g",
  kind: "plan",
  credits: 1000,
  usedCredits: 0,
  grantedAt: "2026-09-25T10:00:00.000Z",
  expiresAt: "2026-10-28T10:00:00.000Z",
  periodEnd: PERIOD_END,
  live: true,
  inCurrentPeriod: true,
  ...overrides,
});

const strip = (pools: ReturnType<typeof balancePools>) => pools.map(({ key: _key, ...pool }) => pool);

test("current credits split into pools in spend order, a renewal and its upgrade adding up to one plan pool", () => {
  const pools = balancePools([
    view({ id: "renewal", credits: 14500, usedCredits: 600 }),
    view({ id: "upgrade", credits: 3985, grantedAt: "2026-09-30T08:00:00.000Z", periodEnd: "2026-10-25T10:00:05.000Z" }),
    view({ id: "trial", kind: "trial", credits: 400, usedCredits: 100, expiresAt: "2026-10-02T10:00:00.000Z", periodEnd: "2026-10-02T10:00:00.000Z" }),
    view({ id: "t1", kind: "topup", credits: 4000, expiresAt: null, periodEnd: null }),
    view({ id: "old", credits: 2500, usedCredits: 2500, periodEnd: "2026-09-25T10:00:00.000Z", live: false, inCurrentPeriod: false }),
  ]);
  assert.deepEqual(strip(pools), [
    { kind: "trial", earlier: false, available: 300, credits: 400, validUntil: "2026-10-02T10:00:00.000Z" },
    { kind: "plan", earlier: false, available: 17885, credits: 18485, validUntil: "2026-10-25T10:00:05.000Z" },
    { kind: "topup", earlier: false, available: 4000, credits: 4000, validUntil: null },
  ]);
});

test("after a renewal, the last period's leftover is its own earlier pool, valid until the grace ends", () => {
  const pools = balancePools([
    view({ id: "aug", credits: 2500, usedCredits: 1200, grantedAt: "2026-08-25T10:00:00.000Z", expiresAt: "2026-09-28T10:00:00.000Z", periodEnd: "2026-09-25T10:00:00.000Z", inCurrentPeriod: false }),
    view({ id: "sep", credits: 2500 }),
  ]);
  assert.deepEqual(strip(pools), [
    { kind: "plan", earlier: true, available: 1300, credits: 2500, validUntil: "2026-09-28T10:00:00.000Z" },
    { kind: "plan", earlier: false, available: 2500, credits: 2500, validUntil: PERIOD_END },
  ]);
});

test("a plan used up mid-period stays as an empty pool until the period ends; a spent top-up drops out", () => {
  const pools = balancePools([
    view({ credits: 2500, usedCredits: 2500, live: false }),
    view({ kind: "topup", credits: 4000, usedCredits: 4000, expiresAt: null, periodEnd: null, live: false }),
  ]);
  assert.deepEqual(strip(pools), [{ kind: "plan", earlier: false, available: 0, credits: 2500, validUntil: PERIOD_END }]);
});

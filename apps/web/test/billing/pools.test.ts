import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreditGrantView } from "../../src/lib/billing/credits/service";
import { balancePools } from "../../src/lib/billing/credits/pools";

const view = (overrides: Partial<CreditGrantView>): CreditGrantView => ({
  id: "g",
  kind: "plan",
  credits: 1000,
  usedCredits: 0,
  grantedAt: "2026-09-25T10:00:00.000Z",
  expiresAt: "2026-10-28T10:00:00.000Z",
  periodEnd: "2026-10-25T10:00:00.000Z",
  live: true,
  inCurrentPeriod: true,
  ...overrides,
});

test("current credits split into pools in spend order, each valid until its period end", () => {
  const pools = balancePools([
    view({ id: "renewal", credits: 14500, usedCredits: 600 }),
    view({ id: "upgrade", credits: 3985, grantedAt: "2026-09-30T08:00:00.000Z", periodEnd: "2026-10-25T10:00:05.000Z" }),
    view({ id: "trial", kind: "trial", credits: 400, usedCredits: 100, expiresAt: "2026-10-02T10:00:00.000Z", periodEnd: "2026-10-02T10:00:00.000Z" }),
    view({ id: "t1", kind: "topup", credits: 4000, expiresAt: null, periodEnd: null }),
    view({ id: "old", credits: 2500, usedCredits: 2500, periodEnd: "2026-09-25T10:00:00.000Z", live: false, inCurrentPeriod: false }),
  ]);
  assert.deepEqual(pools, [
    { kind: "trial", available: 300, credits: 400, validUntil: "2026-10-02T10:00:00.000Z" },
    { kind: "plan", available: 17885, credits: 18485, validUntil: "2026-10-25T10:00:05.000Z" },
    { kind: "topup", available: 4000, credits: 4000, validUntil: null },
  ]);
});

test("a plan used up mid-period stays as an empty pool until the period ends", () => {
  assert.deepEqual(balancePools([view({ credits: 2500, usedCredits: 2500, live: false })]), [
    { kind: "plan", available: 0, credits: 2500, validUntil: "2026-10-25T10:00:00.000Z" },
  ]);
});

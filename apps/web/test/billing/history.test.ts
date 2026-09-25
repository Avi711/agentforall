import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreditGrantView } from "../../src/lib/billing/credits/service";
import { usageHistory } from "../../src/lib/billing/credits/history";

const view = (overrides: Partial<CreditGrantView>): CreditGrantView => ({
  id: "g",
  kind: "plan",
  credits: 1000,
  usedCredits: 0,
  grantedAt: "2026-09-25T10:00:00.000Z",
  expiresAt: "2026-10-28T10:00:00.000Z",
  live: true,
  ...overrides,
});

test("a period's renewal and upgrade credits add up; periods run newest first, then the trial, then all top-ups", () => {
  const history = usageHistory([
    view({ id: "aug", credits: 2500, usedCredits: 2400, grantedAt: "2026-08-25T10:00:00.000Z", expiresAt: "2026-09-28T10:00:00.000Z", live: false }),
    view({ id: "sep", credits: 2500, usedCredits: 900 }),
    view({ id: "upgrade", credits: 3985, usedCredits: 0, grantedAt: "2026-09-30T08:00:00.000Z", expiresAt: "2026-10-28T10:00:05.000Z" }),
    view({ id: "trial", kind: "trial", credits: 400, usedCredits: 400, grantedAt: "2026-08-18T10:00:00.000Z", expiresAt: "2026-08-25T10:00:00.000Z", live: false }),
    view({ id: "t1", kind: "topup", credits: 4000, usedCredits: 1000, expiresAt: null }),
    view({ id: "t2", kind: "topup", credits: 2000, usedCredits: 0, expiresAt: null }),
  ]);
  assert.deepEqual(
    history.map(({ key, credits, used, current, startsAt, endsAt }) => ({ key, credits, used, current, startsAt, endsAt })),
    [
      { key: "2026-10-25", credits: 6485, used: 900, current: true, startsAt: "2026-09-25T10:00:00.000Z", endsAt: "2026-10-25T10:00:00.000Z" },
      { key: "2026-09-25", credits: 2500, used: 2400, current: false, startsAt: "2026-08-25T10:00:00.000Z", endsAt: "2026-09-25T10:00:00.000Z" },
      { key: "trial", credits: 400, used: 400, current: false, startsAt: "2026-08-18T10:00:00.000Z", endsAt: "2026-08-25T10:00:00.000Z" },
      { key: "topups", credits: 6000, used: 1000, current: true, startsAt: null, endsAt: null },
    ],
  );
});

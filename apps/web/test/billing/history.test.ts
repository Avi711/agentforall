import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreditGrantView } from "../../src/lib/billing/credits/service";
import { pastPeriods } from "../../src/lib/billing/credits/history";

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

const ended = { live: false, inCurrentPeriod: false } as const;

test("past periods add up a period's renewal and upgrade, newest first, then the trial; the current period and top-ups stay out", () => {
  const history = pastPeriods([
    view({ id: "jul", credits: 2500, usedCredits: 1200, grantedAt: "2026-07-25T10:00:00.000Z", periodEnd: "2026-08-25T10:00:00.000Z", ...ended }),
    view({ id: "aug", credits: 2500, usedCredits: 2400, grantedAt: "2026-08-25T10:00:00.000Z", periodEnd: "2026-09-25T10:00:00.000Z", ...ended }),
    view({ id: "aug-up", credits: 3985, usedCredits: 3985, grantedAt: "2026-09-01T08:00:00.000Z", periodEnd: "2026-09-25T10:00:05.000Z", ...ended }),
    view({ id: "sep", credits: 2500, usedCredits: 900 }),
    view({ id: "trial", kind: "trial", credits: 400, usedCredits: 400, grantedAt: "2026-07-18T10:00:00.000Z", periodEnd: "2026-07-25T10:00:00.000Z", ...ended }),
    view({ id: "t1", kind: "topup", credits: 4000, usedCredits: 1000, expiresAt: null, periodEnd: null }),
  ]);
  assert.deepEqual(
    history.map(({ key, kind, credits, used, startsAt }) => ({ key, kind, credits, used, startsAt })),
    [
      { key: "2026-09-25", kind: "plan", credits: 6485, used: 6385, startsAt: "2026-08-25T10:00:00.000Z" },
      { key: "2026-08-25", kind: "plan", credits: 2500, used: 1200, startsAt: "2026-07-25T10:00:00.000Z" },
      { key: "trial", kind: "trial", credits: 400, used: 400, startsAt: "2026-07-18T10:00:00.000Z" },
    ],
  );
});

test("the last period is history as soon as it ends, even while its leftover is in the renewal grace", () => {
  const history = pastPeriods([
    view({ id: "aug", credits: 2500, usedCredits: 1200, grantedAt: "2026-08-25T10:00:00.000Z", periodEnd: "2026-09-25T10:00:00.000Z", inCurrentPeriod: false }),
    view({ id: "sep", credits: 2500 }),
  ]);
  assert.deepEqual(
    history.map(({ key, used, credits }) => ({ key, used, credits })),
    [{ key: "2026-09-25", used: 1200, credits: 2500 }],
  );
});

test("a live trial is not history yet", () => {
  assert.deepEqual(pastPeriods([view({ kind: "trial", periodEnd: "2026-10-02T10:00:00.000Z" })]), []);
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS } from "../../src/lib/billing/dates";
import { LOW_BALANCE_RATIO, TRIAL_CREDITS, TRIAL_DAYS, usdCentsFromCredits } from "../../src/lib/billing/pricing";
import { BOT_ID, NOW, USER, creditHarness, grant, last } from "./fakes";

const BOT_2 = "1b2c3d4e-0000-4000-8000-000000000002";

describe("grants", () => {
  test("trial is granted once, sized from pricing, and expires after TRIAL_DAYS", async () => {
    const h = creditHarness();
    assert.equal(await h.credits.startTrial(USER.id), true);
    assert.equal(await h.credits.startTrial(USER.id), false);
    const [trial] = h.grants.rows;
    assert.deepEqual({ kind: trial?.kind, credits: trial?.credits, expires: trial?.expiresAt?.getTime() }, { kind: "trial", credits: TRIAL_CREDITS, expires: NOW.getTime() + TRIAL_DAYS * DAY_MS });
    assert.equal(h.grants.rows.length, 1);
  });

  test("a user with any prior grant reads as trial used", async () => {
    const h = creditHarness();
    h.grants.rows.push(grant({ kind: "plan" }));
    assert.deepEqual(await h.credits.trialState(USER.id), { kind: "used" });
  });

  test("trialState walks available → active → used", async () => {
    let now = NOW;
    const h = creditHarness({ now: () => now });
    assert.deepEqual(await h.credits.trialState(USER.id), { kind: "available" });
    await h.credits.startTrial(USER.id);
    const active = await h.credits.trialState(USER.id);
    assert.equal(active.kind, "active");
    if (active.kind === "active") assert.equal(active.remainingCredits, TRIAL_CREDITS);
    now = new Date(NOW.getTime() + TRIAL_DAYS * DAY_MS + 1);
    assert.deepEqual(await h.credits.trialState(USER.id), { kind: "used" });
  });

  test("plan and top-up grants are idempotent on sourceRef", async () => {
    const h = creditHarness();
    const expiry = new Date("2026-09-29T00:00:00.000Z");
    assert.equal(await h.credits.grantPlanCredits(USER.id, 1000, expiry, "plan:mock:pay_1"), true);
    assert.equal(await h.credits.grantPlanCredits(USER.id, 1000, expiry, "plan:mock:pay_1"), false);
    assert.equal(await h.credits.grantTopup(USER.id, 500, "topup:mock:pay_2"), true);
    assert.equal(await h.credits.grantTopup(USER.id, 500, "topup:mock:pay_2"), false);
    assert.equal(h.grants.rows.length, 2);
  });
});

describe("sync", () => {
  test("a user with no grants is left alone: no gateway read, no cap", async () => {
    const h = creditHarness();
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 300 });
    const summary = await h.credits.sync(USER.id);
    assert.deepEqual({ reads: h.llm.readCalls, ceiling: h.llm.lastCeiling(BOT_ID), available: summary.available, trial: summary.trial }, { reads: 0, ceiling: null, available: 0, trial: { kind: "available" } });
  });

  test("settleBot charges spend since the last sync and throws when the gateway cannot be read", async () => {
    const h = creditHarness();
    await h.credits.startTrial(USER.id);
    h.llm.addBot(USER.id, BOT_ID);
    await h.credits.sync(USER.id);
    h.llm.setSpend(BOT_ID, { spendUsdCents: 50 });
    await h.credits.settleBot(USER.id, BOT_ID);
    assert.deepEqual({ used: h.grants.rows[0]?.usedCredits, cursor: h.usage.rows[0]?.lastSpendUsdCents }, { used: 100, cursor: 50 });
    h.llm.failReadsFor.add(BOT_ID);
    await assert.rejects(h.credits.settleBot(USER.id, BOT_ID), /gateway unreachable/);
  });

  test("caps a fresh bot at spend + available credits", async () => {
    const h = creditHarness();
    await h.credits.startTrial(USER.id);
    h.llm.addBot(USER.id, BOT_ID);
    const summary = await h.credits.sync(USER.id);
    assert.deepEqual({ available: summary.available, allowance: summary.allowance, consumed: summary.consumed, stale: summary.stale }, { available: TRIAL_CREDITS, allowance: TRIAL_CREDITS, consumed: 0, stale: false });
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(TRIAL_CREDITS));
    assert.equal(h.usage.rows[0]?.version, 1);
  });

  test("attributes new spend soonest-expiring first and lowers the ceiling", async () => {
    const h = creditHarness();
    await h.credits.startTrial(USER.id);
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID);
    await h.credits.sync(USER.id);

    h.llm.setSpend(BOT_ID, { spendUsdCents: 250 });
    const summary = await h.credits.sync(USER.id);
    assert.equal(h.grants.rows.find((g) => g.kind === "trial")?.usedCredits, 400);
    assert.equal(h.grants.rows.find((g) => g.kind === "topup")?.usedCredits, 100);
    assert.deepEqual({ consumed: summary.consumed, available: summary.available }, { consumed: 500, available: 900 });
    assert.equal(h.llm.lastCeiling(BOT_ID), 250 + usdCentsFromCredits(900));
  });

  test("a spend counter that went backwards is a restarted counter, whatever the reason", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 300 });
    await h.credits.sync(USER.id);
    h.llm.setSpend(BOT_ID, { spendUsdCents: 50 });
    const summary = await h.credits.sync(USER.id);
    assert.equal(summary.consumed, 700);
    assert.equal(h.llm.lastCeiling(BOT_ID), 50 + usdCentsFromCredits(300));
  });

  test("unchanged spend writes nothing but still corrects a wrong ceiling", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID);
    await h.credits.sync(USER.id);
    const advances = h.usage.advances;
    h.llm.setSpend(BOT_ID, { maxBudgetUsdCents: 99999 });
    await h.credits.sync(USER.id);
    assert.equal(h.usage.advances, advances);
    assert.equal(h.usage.rows[0]?.version, 1);
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(1000));
  });

  test("spend made before a grant expired is charged to that grant, not to top-ups", async () => {
    let now = NOW;
    const h = creditHarness({ now: () => now });
    await h.credits.grantPlanCredits(USER.id, 1000, new Date(NOW.getTime() + DAY_MS), "plan:mock:pay_1");
    await h.credits.grantTopup(USER.id, 500, "topup:mock:pay_2");
    h.llm.addBot(USER.id, BOT_ID);
    await h.credits.sync(USER.id);

    now = new Date(NOW.getTime() + 2 * DAY_MS);
    h.llm.setSpend(BOT_ID, { spendUsdCents: 100 });
    const summary = await h.credits.sync(USER.id);
    assert.equal(h.grants.rows.find((g) => g.kind === "plan")?.usedCredits, 200);
    assert.equal(h.grants.rows.find((g) => g.kind === "topup")?.usedCredits, 0);
    assert.equal(summary.available, 500);
  });

  test("records over-consumption instead of hiding it", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 100, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 200 });
    const summary = await h.credits.sync(USER.id);
    assert.deepEqual({ consumed: summary.consumed, unallocated: summary.unallocated, available: summary.available }, { consumed: 400, unallocated: 300, available: 0 });
    assert.equal(h.llm.lastCeiling(BOT_ID), 200);
    assert.match(h.logs.warnings[0] ?? "", /exceeded/);
  });

  test("survives losing the version race and re-reads grants before retrying", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 10 });
    h.usage.interfereNext = true;
    const summary = await h.credits.sync(USER.id);
    assert.equal(summary.consumed, 20);
    assert.equal(h.grants.rows[0]?.usedCredits, 20);
    assert.equal(h.llm.lastCeiling(BOT_ID), 10 + usdCentsFromCredits(980));
  });

  test("two bots never over-attribute the same grant", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 30, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 10 });
    h.llm.addBot(USER.id, BOT_2, { spendUsdCents: 10 });
    const summary = await h.credits.sync(USER.id);
    const topup = last(h.grants.rows);
    assert.ok(topup.usedCredits <= topup.credits);
    assert.deepEqual({ used: topup.usedCredits, unallocated: summary.unallocated, consumed: summary.consumed }, { used: 30, unallocated: 10, consumed: 40 });
  });

  test("a bot the gateway cannot report on leaves the others synced and marks the summary stale", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID);
    h.llm.addBot(USER.id, BOT_2);
    h.llm.failReadsFor.add(BOT_ID);
    const summary = await h.credits.sync(USER.id);
    assert.equal(summary.stale, true);
    assert.equal(h.llm.lastCeiling(BOT_2), usdCentsFromCredits(1000));
    assert.equal(h.llm.lastCeiling(BOT_ID), null);
  });

  test("expired plan credits drop out of the allowance and the ceiling follows", async () => {
    let now = NOW;
    const h = creditHarness({ now: () => now });
    await h.credits.grantPlanCredits(USER.id, 1000, new Date(NOW.getTime() + DAY_MS), "plan:mock:pay_1");
    await h.credits.grantTopup(USER.id, 200, "topup:mock:pay_2");
    h.llm.addBot(USER.id, BOT_ID);
    await h.credits.sync(USER.id);
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(1200));
    now = new Date(NOW.getTime() + 2 * DAY_MS);
    const summary = await h.credits.sync(USER.id);
    assert.equal(summary.available, 200);
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(200));
  });

  test("skips unsupported bots", async () => {
    const h = creditHarness();
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID, { supported: false });
    await h.credits.sync(USER.id);
    assert.equal(h.usage.rows.length, 0);
    assert.equal(h.llm.ceilings.length, 0);
  });
});

describe("summary and cron", () => {
  test("summary reads the ledger without touching the gateway", async () => {
    const h = creditHarness();
    assert.equal((await h.credits.summary(USER.id)).syncedAt, null);
    await h.credits.grantTopup(USER.id, 1000, "topup:mock:pay_1");
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 400 });
    await h.credits.sync(USER.id);
    const reads = h.llm.readCalls;
    const summary = await h.credits.summary(USER.id);
    assert.equal(h.llm.readCalls, reads);
    assert.deepEqual({ consumed: summary.consumed, available: summary.available, lowBalance: summary.lowBalance, syncedAt: summary.syncedAt }, { consumed: 800, available: 200, lowBalance: true, syncedAt: NOW.toISOString() });
  });

  test("lowBalance flips exactly at the ratio and is off with no allowance", async () => {
    const h = creditHarness();
    assert.equal((await h.credits.summary(USER.id)).lowBalance, false);
    h.grants.rows.push(grant({ credits: 1000, usedCredits: 1000 - 1000 * LOW_BALANCE_RATIO }));
    assert.equal((await h.credits.summary(USER.id)).lowBalance, true);
    h.grants.rows[0]!.usedCredits -= 1;
    assert.equal((await h.credits.summary(USER.id)).lowBalance, false);
  });

  test("syncAll covers every user with a credit history, including lapsed ones, and isolates failures", async () => {
    let now = NOW;
    const h = creditHarness({ now: () => now });
    await h.credits.grantTopup("user-a", 100, "topup:a");
    await h.credits.grantPlanCredits("user-b", 100, new Date(NOW.getTime() + DAY_MS), "plan:b");
    await h.credits.grantTopup("user-c", 100, "topup:c");
    h.llm.addBot("user-a", BOT_ID);
    h.llm.addBot("user-b", BOT_2, { spendUsdCents: 10, maxBudgetUsdCents: 60 });
    h.llm.listLiveBotIds = async (userId) => {
      if (userId === "user-c") throw new Error("orchestrator down");
      return userId === "user-a" ? [BOT_ID] : userId === "user-b" ? [BOT_2] : [];
    };
    now = new Date(NOW.getTime() + 2 * DAY_MS);
    const result = await h.credits.syncAll();
    assert.deepEqual(result, { users: 3, failures: ["user-c"] });
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(100));
    assert.equal(h.llm.lastCeiling(BOT_2), 10);
  });
});

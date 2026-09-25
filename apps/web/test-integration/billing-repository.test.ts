import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDb,
  billingCheckoutSessions,
  billingCreditGrants,
  billingCreditUsage,
  billingEvents,
  billingPayments,
  billingSubscriptions,
  billingTrialClaims,
  user,
} from "@agent-forall/db";
import { eq, like, sql } from "drizzle-orm";
import { MAX_EVENT_ATTEMPTS } from "../src/lib/billing/domain";
import {
  DrizzleBillingEventRepository,
  DrizzleCheckoutSessionRepository,
  DrizzleCreditGrantRepository,
  DrizzleCreditUsageRepository,
  DrizzlePaymentRepository,
  DrizzleSubscriptionRepository,
  DrizzleTrialClaimRepository,
} from "../src/lib/billing/repository";

// Runs only against a disposable database: `BILLING_TEST_DATABASE_URL=... npm run test:integration`.
const url = process.env.BILLING_TEST_DATABASE_URL;

describe("billing repositories (postgres)", { skip: url ? false : "BILLING_TEST_DATABASE_URL not set" }, () => {
  const db = createDb(url ?? "postgres://unused");
  const userId = `it-user-${randomUUID()}`;
  const subscriptions = new DrizzleSubscriptionRepository(db);
  const checkouts = new DrizzleCheckoutSessionRepository(db);
  const payments = new DrizzlePaymentRepository(db);
  const grants = new DrizzleCreditGrantRepository(db);
  const usage = new DrizzleCreditUsageRepository(db);
  const events = new DrizzleBillingEventRepository(db);
  const trialClaims = new DrizzleTrialClaimRepository(db);
  const NOW = new Date("2026-08-26T10:00:00.000Z");

  before(async () => {
    await db.insert(user).values({ id: userId, email: `${userId}@example.com` });
  });

  // Rows with `set null` foreign keys survive the user's deletion, so they are removed by their own keys.
  after(async () => {
    await db.delete(billingEvents).where(like(billingEvents.providerEventId, `${userId}:%`));
    await db.delete(billingPayments).where(like(billingPayments.providerPaymentId, `${userId}:%`));
    await db.delete(billingSubscriptions).where(like(billingSubscriptions.providerSubscriptionId, `${userId}:%`));
    await db.delete(billingTrialClaims).where(like(billingTrialClaims.emailHash, `${userId}:%`));
    await db.delete(user).where(eq(user.id, userId));
  });

  test("upsertIfNewer applies same-instant and newer snapshots, drops older ones, and never overwrites user_id", async () => {
    const base = {
      provider: "mock" as const,
      providerSubscriptionId: `${userId}:sub`,
      userId,
      providerCustomerId: null,
      planCode: "standard",
      status: "active" as const,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      trialEndsAt: null,
      providerUpdatedAt: NOW,
    };
    assert.equal((await subscriptions.upsertIfNewer(base)).applied, true);
    assert.equal((await subscriptions.upsertIfNewer({ ...base, userId: null, status: "canceled" })).applied, true);
    const older = await subscriptions.upsertIfNewer({ ...base, status: "active", providerUpdatedAt: new Date(NOW.getTime() - 1) });
    assert.deepEqual({ applied: older.applied, status: older.subscription.status, userId: older.subscription.userId }, { applied: false, status: "canceled", userId });
  });

  test("recordRenewal is atomic: duplicate payments and period races write nothing", async () => {
    const created = await subscriptions.upsertIfNewer({
      provider: "mock",
      providerSubscriptionId: `${userId}:renew`,
      userId,
      providerCustomerId: null,
      planCode: "standard",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: NOW,
      trialEndsAt: null,
      providerUpdatedAt: NOW,
    });
    const payment = { userId, provider: "mock" as const, providerPaymentId: `${userId}:pay`, status: "succeeded" as const, amountAgorot: 20000, currency: "ILS", occurredAt: NOW };
    const later = new Date(NOW.getTime() + 1000);
    const raced = await payments.recordRenewal({ payment, subscriptionId: created.subscription.id, expectedPeriodEnd: later, patch: { currentPeriodEnd: later, providerUpdatedAt: NOW } });
    assert.equal(raced.outcome, "conflict");
    const stored = await db.select().from(billingPayments).where(eq(billingPayments.providerPaymentId, payment.providerPaymentId));
    assert.equal(stored.length, 0);

    const applied = await payments.recordRenewal({ payment, subscriptionId: created.subscription.id, expectedPeriodEnd: NOW, patch: { currentPeriodEnd: later, providerUpdatedAt: NOW } });
    assert.equal(applied.outcome, "applied");
    const again = await payments.recordRenewal({ payment, subscriptionId: created.subscription.id, expectedPeriodEnd: later, patch: { currentPeriodEnd: later, providerUpdatedAt: NOW } });
    assert.equal(again.outcome, "duplicate");
  });

  test("advance is version-guarded and refuses attributions that overflow a grant", async () => {
    const botId = randomUUID();
    const grant = await grants.insertIfAbsent({ userId, kind: "topup", credits: 10, sourceRef: `${userId}:topup`, expiresAt: null });
    assert.ok(grant);
    const advance = (expectedVersion: number, credits: number) =>
      usage.advance({ botId, userId, expectedVersion, spendUsdCents: 5, consumedDelta: credits, unallocatedDelta: 0, attributions: [{ grantId: grant.id, credits }], syncedAt: NOW });
    assert.equal(await advance(0, 8), true);
    assert.equal(await advance(0, 1), false);
    assert.equal(await advance(1, 5), false);
    const [cursor] = await db.select().from(billingCreditUsage).where(eq(billingCreditUsage.botId, botId));
    const [row] = await db.select().from(billingCreditGrants).where(eq(billingCreditGrants.id, grant.id));
    assert.deepEqual({ version: cursor?.version, consumed: cursor?.consumedCredits, used: row?.usedCredits }, { version: 1, consumed: 8, used: 8 });
    assert.equal(await advance(1, 2), true);
  });

  test("claim hands a failed event to exactly one retry and treats the rest as duplicates", async () => {
    const input = { provider: "mock" as const, providerEventId: `${userId}:evt`, eventType: "test", providerSubscriptionId: null, payload: {} };
    const first = await events.claim(input);
    assert.equal(first.kind, "new");
    assert.equal((await events.claim(input)).kind, "duplicate");
    if (first.kind === "new") await events.finish(first.id, { status: "failed", note: "boom" });
    const [retry, contender] = await Promise.all([events.claim(input), events.claim(input)]);
    assert.deepEqual([retry.kind, contender.kind].sort(), ["duplicate", "retry"]);
  });

  test("checkout sessions settle once and count by user since a point in time", async () => {
    const input = { userId, provider: "mock" as const, kind: "subscription" as const, productCode: "standard", credits: 2500, amountAgorot: 20000, expiresAt: new Date(NOW.getTime() + 3600_000) };
    const created = await checkouts.create(input);
    const providerCheckoutId = `prov-${randomUUID()}`;
    await checkouts.setProviderCheckoutId(created.id, providerCheckoutId);
    const found = await checkouts.findById(created.id);
    assert.deepEqual({ status: found?.status, providerCheckoutId: found?.providerCheckoutId, settledAt: found?.settledAt }, { status: "pending", providerCheckoutId, settledAt: null });
    assert.equal((await checkouts.findByProviderCheckoutId("mock", providerCheckoutId))?.id, created.id);
    assert.equal(await checkouts.findByProviderCheckoutId("paddle", providerCheckoutId), null);
    const twin = await checkouts.create(input);
    await assert.rejects(checkouts.setProviderCheckoutId(twin.id, providerCheckoutId));
    await checkouts.settle(twin.id, "failed", NOW);

    await checkouts.settle(created.id, "completed", NOW);
    await checkouts.settle(created.id, "failed", new Date(NOW.getTime() + 1));
    const settled = await checkouts.findById(created.id);
    assert.deepEqual({ status: settled?.status, settledAt: settled?.settledAt }, { status: "completed", settledAt: NOW });

    await checkouts.create(input);
    const [sinceEpoch, sinceFuture, pendingNow, pendingLater] = await Promise.all([
      checkouts.countOpenedSince(userId, new Date(0)),
      checkouts.countOpenedSince(userId, new Date(Date.now() + 60_000)),
      checkouts.hasPendingSince(userId, new Date(0)),
      checkouts.hasPendingSince(userId, new Date(Date.now() + 60_000)),
    ]);
    assert.deepEqual({ sinceEpoch, sinceFuture, pendingNow, pendingLater }, { sinceEpoch: 3, sinceFuture: 0, pendingNow: true, pendingLater: false });
  });

  test("the open checkout for a product is the newest pending one created at the provider and open past the cutoff", async () => {
    const product = { userId, provider: "mock" as const, kind: "topup" as const, productCode: "topup_ils_50", credits: 2000, amountAgorot: 5000 };
    const expiresAt = new Date(NOW.getTime() + 3600_000);
    const query = { ...product, openUntil: NOW };
    assert.equal(await checkouts.findReopenable(query), null);
    const older = await checkouts.create({ ...product, expiresAt });
    await checkouts.setProviderCheckoutId(older.id, `prov-${randomUUID()}`);
    const newer = await checkouts.create({ ...product, expiresAt });
    await checkouts.setProviderCheckoutId(newer.id, `prov-${randomUUID()}`);
    await checkouts.create({ ...product, expiresAt });
    assert.equal((await checkouts.findReopenable(query))?.id, newer.id);
    assert.equal(await checkouts.findReopenable({ ...query, amountAgorot: 6000 }), null);
    assert.equal(await checkouts.findReopenable({ ...query, openUntil: expiresAt }), null);
    await checkouts.settle(newer.id, "failed", NOW);
    assert.equal((await checkouts.findReopenable(query))?.id, older.id);
  });

  test("a trial claim belongs to one mailbox and is idempotent for the same user only", async () => {
    const hash = `${userId}:hash`;
    assert.equal(await trialClaims.findClaimant(hash), null);
    assert.equal(await trialClaims.claim(hash, userId), true);
    assert.equal(await trialClaims.claim(hash, userId), true);
    assert.equal(await trialClaims.claim(hash, "someone-else"), false);
    assert.deepEqual(await trialClaims.findClaimant(hash), { userId });
    await db.update(billingTrialClaims).set({ userId: null }).where(eq(billingTrialClaims.emailHash, hash));
    assert.deepEqual(await trialClaims.findClaimant(hash), { userId: null });
    assert.equal(await trialClaims.claim(hash, "someone-else"), false);
  });

  test("metered users are listed least recently synced first, never-synced ahead of all", async () => {
    const other = `it-user-${randomUUID()}`;
    await db.insert(user).values({ id: other, email: `${other}@example.com` });
    try {
      await grants.insertIfAbsent({ userId: other, kind: "topup", credits: 10, sourceRef: `${userId}:other-topup`, expiresAt: null });
      const ordered = await usage.listMeteredUserIds();
      const mine = ordered.indexOf(userId);
      const theirs = ordered.indexOf(other);
      assert.ok(mine >= 0 && theirs >= 0);
      assert.ok(theirs < mine, "a user never synced comes before one with a cursor");
    } finally {
      await db.delete(user).where(eq(user.id, other));
    }
  });

  test("a failed event stops being reclaimed after MAX_EVENT_ATTEMPTS deliveries", async () => {
    const input = { provider: "mock" as const, providerEventId: `${userId}:poison`, eventType: "test", providerSubscriptionId: null, payload: {} };
    const first = await events.claim(input);
    assert.equal(first.kind, "new");
    if (first.kind !== "new") return;
    await events.finish(first.id, { status: "failed", note: "boom" });
    await db.update(billingEvents).set({ attempts: MAX_EVENT_ATTEMPTS - 1 }).where(eq(billingEvents.id, first.id));
    assert.deepEqual(await events.claim(input), { kind: "retry", id: first.id });
    await events.finish(first.id, { status: "failed", note: "boom" });
    assert.deepEqual(await events.claim(input), { kind: "duplicate", status: "failed" });
  });

  test("recordFirstPayment links payment and subscription atomically and is idempotent per payment id", async () => {
    const subscription = { provider: "mock" as const, providerSubscriptionId: `${userId}:first`, userId, providerCustomerId: null, planCode: "standard", status: "active" as const, cancelAtPeriodEnd: false, currentPeriodEnd: NOW, trialEndsAt: null, providerUpdatedAt: NOW };
    const payment = { userId, provider: "mock" as const, providerPaymentId: `${userId}:first-pay`, status: "succeeded" as const, amountAgorot: 20000, currency: "ILS", occurredAt: NOW };
    const first = await payments.recordFirstPayment({ payment, subscription });
    assert.equal(first.outcome, "applied");
    if (first.outcome !== "applied") return;
    const [stored] = await db.select().from(billingPayments).where(eq(billingPayments.providerPaymentId, payment.providerPaymentId));
    assert.equal(stored?.subscriptionId, first.subscription.id);

    const again = await payments.recordFirstPayment({ payment, subscription });
    assert.equal(again.outcome, "duplicate");
    assert.equal(await payments.lastSucceededAmountAgorot(first.subscription.id), 20000);
    assert.equal(await payments.lastSucceededAmountAgorot(randomUUID()), null);
    const current = await subscriptions.findCurrentByUserId(userId);
    assert.equal(current?.id, first.subscription.id);

    await subscriptions.updateState(first.subscription.id, { status: "canceled", providerUpdatedAt: NOW });
    const live = await subscriptions.listLiveByUserId(userId);
    assert.ok(live.every((s) => s.id !== first.subscription.id));
  });

  test("grants are idempotent per source_ref and users with any grant are listed once", async () => {
    const input = { userId, kind: "trial" as const, credits: 400, sourceRef: `${userId}:trial`, expiresAt: new Date(NOW.getTime() + 7 * 86_400_000) };
    const granted = await grants.insertIfAbsent(input);
    assert.ok(granted);
    assert.equal(await grants.insertIfAbsent(input), null);
    const listed = await grants.listByUserId(userId);
    assert.ok(listed.some((g) => g.id === granted.id && g.usedCredits === 0));
    const users = await usage.listMeteredUserIds();
    assert.equal(users.filter((id) => id === userId).length, 1);
  });

  test("a refund marks the payment and shrinks only that charge's grants to what was spent", async () => {
    const paymentId = `${userId}:refund-pay`;
    await payments.record({ userId, subscriptionId: null, provider: "paddle", providerPaymentId: paymentId, status: "succeeded", amountAgorot: 5000, currency: "ILS", occurredAt: NOW });
    const refunded = await grants.insertIfAbsent({ userId, kind: "topup", credits: 2000, sourceRef: `topup:paddle:${paymentId}`, expiresAt: null });
    const untouched = await grants.insertIfAbsent({ userId, kind: "topup", credits: 700, sourceRef: `${userId}:other-topup`, expiresAt: null });
    assert.ok(refunded && untouched);
    await db.update(billingCreditGrants).set({ usedCredits: 150 }).where(eq(billingCreditGrants.id, refunded.id));

    assert.deepEqual(await payments.markRefunded("paddle", paymentId), { userId });
    assert.equal(await payments.markRefunded("paddle", `${userId}:never-paid`), null);
    assert.deepEqual(await grants.revokeUnused([`topup:paddle:${paymentId}`, `plan:paddle:${paymentId}`]), [userId]);
    assert.deepEqual(await grants.revokeUnused([`topup:paddle:${paymentId}`]), []);
    const after = await grants.listByUserId(userId);
    assert.deepEqual(
      [after.find((g) => g.id === refunded.id)?.credits, after.find((g) => g.id === untouched.id)?.credits],
      [150, 700],
    );
    const [stored] = await db.select().from(billingPayments).where(eq(billingPayments.providerPaymentId, paymentId));
    assert.equal(stored?.status, "refunded");
  });

  test("a user metered with no credits at all is listed for the cron", async () => {
    const metered = `it-user-${randomUUID()}`;
    await db.insert(user).values({ id: metered, email: `${metered}@example.com` });
    try {
      const botId = randomUUID();
      assert.equal(await usage.advance({ botId, userId: metered, expectedVersion: 0, spendUsdCents: 5, consumedDelta: 10, unallocatedDelta: 10, attributions: [], syncedAt: NOW }), true);
      assert.ok((await usage.listMeteredUserIds()).includes(metered));
    } finally {
      await db.delete(user).where(eq(user.id, metered));
    }
  });

  test("advance creates the cursor on first sync and stores unallocated spend", async () => {
    const botId = randomUUID();
    assert.equal(await usage.findByBotId(botId), null);
    assert.equal(await usage.advance({ botId, userId, expectedVersion: 0, spendUsdCents: 3, consumedDelta: 6, unallocatedDelta: 6, attributions: [], syncedAt: NOW }), true);
    const cursor = await usage.findByBotId(botId);
    assert.deepEqual(
      { lastSpendUsdCents: cursor?.lastSpendUsdCents, consumedCredits: cursor?.consumedCredits, unallocatedCredits: cursor?.unallocatedCredits, version: cursor?.version },
      { lastSpendUsdCents: 3, consumedCredits: 6, unallocatedCredits: 6, version: 1 },
    );
    assert.ok((await usage.listByUserId(userId)).some((c) => c.botId === botId));
  });

  test("claim reclaims an event abandoned in `received` but not a fresh one, and finish records the user", async () => {
    const input = { provider: "mock" as const, providerEventId: `${userId}:abandoned`, eventType: "test", providerSubscriptionId: null, payload: {} };
    const first = await events.claim(input);
    assert.equal(first.kind, "new");
    if (first.kind !== "new") return;
    assert.deepEqual(await events.claim(input), { kind: "duplicate", status: "received" });

    await db.update(billingEvents).set({ receivedAt: sql`now() - interval '11 minutes'` }).where(eq(billingEvents.id, first.id));
    const reclaimed = await events.claim(input);
    assert.deepEqual(reclaimed, { kind: "retry", id: first.id });

    await events.finish(first.id, { status: "processed", userId });
    const [row] = await db.select().from(billingEvents).where(eq(billingEvents.id, first.id));
    assert.deepEqual({ status: row?.status, userId: row?.userId, processed: row?.processedAt instanceof Date }, { status: "processed", userId, processed: true });
  });
});

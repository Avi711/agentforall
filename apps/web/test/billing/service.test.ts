import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, HOUR_MS } from "../../src/lib/billing/dates";
import type { CheckoutSession } from "../../src/lib/billing/domain";
import { MAX_EVENT_ATTEMPTS } from "../../src/lib/billing/domain";
import {
  AlreadySubscribedError,
  InvalidTopupAmountError,
  NoSubscriptionError,
  PaymentOverdueError,
  PendingCheckoutError,
  RenewalImminentError,
  SamePlanError,
  TooManyCheckoutsError,
  TrialUnavailableError,
  UnknownProviderError,
  UnsupportedBillingOperationError,
  WebhookInFlightError,
  WebhookVerificationError,
  YearlyPlanChangeError,
} from "../../src/lib/billing/errors";
import { MAX_OPEN_CHECKOUTS_PER_HOUR, PLANS, TRIAL_CREDITS, TRIAL_DAYS, creditsForTopupIls, usdCentsFromCredits, type PlanCode } from "../../src/lib/billing/pricing";
import type { ProviderEvent } from "../../src/lib/billing/provider/types";
import {
  BOT_ID,
  NOW,
  USER,
  emptyRequest,
  grant,
  harness,
  last,
  nextEventId,
  paymentSucceeded,
  subscription,
  type Harness,
} from "./fakes";

const at = (iso: string) => new Date(iso);
const first = <T,>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
};

async function openSubscriptionCheckout(h: Harness, plan: PlanCode = "standard"): Promise<CheckoutSession> {
  await h.service.startCheckout(USER, plan);
  return last(h.checkouts.rows);
}

async function deliver(h: Harness, event: ProviderEvent) {
  h.provider.nextEvent = event;
  return h.service.handleWebhook("mock", emptyRequest);
}

async function deliverExpectingFailure(h: Harness, event: ProviderEvent, note: string) {
  await assert.rejects(deliver(h, event), (err: Error) => err.message === note);
  const row = last(h.events.rows);
  assert.deepEqual({ status: row.status, note: row.note }, { status: "failed", note });
}

const failedCharge = (overrides: Partial<Extract<ProviderEvent, { kind: "payment.failed" }>> = {}): ProviderEvent => ({
  kind: "payment.failed",
  providerEventId: nextEventId(),
  eventType: "payment.failed",
  occurredAt: NOW,
  payload: {},
  providerSubscriptionId: "sub_1",
  payment: { providerPaymentId: "pay_f", amountAgorot: 20000, currency: "ILS" },
  reason: "card_declined",
  reference: { checkoutSessionId: null },
  ...overrides,
});

const canceled = (overrides: Partial<Extract<ProviderEvent, { kind: "subscription.canceled" }>> = {}): ProviderEvent => ({
  kind: "subscription.canceled",
  providerEventId: nextEventId(),
  eventType: "subscription.canceled",
  occurredAt: NOW,
  payload: {},
  providerSubscriptionId: "sub_1",
  accessEndsAt: null,
  reference: { checkoutSessionId: null },
  ...overrides,
});

const snapshot = (updatedAt: string, status: "active" | "canceled", sessionId: string | null = null): ProviderEvent => ({
  kind: "subscription.snapshot",
  providerEventId: nextEventId(),
  eventType: "snapshot",
  occurredAt: at(updatedAt),
  payload: {},
  subscription: {
    providerSubscriptionId: "sub_1",
    providerCustomerId: "cus_1",
    planCode: "standard",
    status,
    cancelAtPeriodEnd: status === "canceled",
    currentPeriodEnd: at("2026-09-26T10:00:00.000Z"),
    trialEndsAt: null,
    providerUpdatedAt: at(updatedAt),
  },
  reference: { checkoutSessionId: sessionId },
});

describe("checkout", () => {
  test("creates a session and hands the provider our correlation id, amount, and return urls", async () => {
    const h = harness();
    const { url } = await h.service.startCheckout(USER, "standard");
    const session = first(h.checkouts.rows);
    assert.equal(url, `https://pay.example/${session.id}`);
    assert.equal(session.providerCheckoutId, `chk_${session.id}`);
    assert.deepEqual(
      { kind: session.kind, productCode: session.productCode, credits: session.credits, amountAgorot: session.amountAgorot },
      { kind: "subscription", productCode: "standard", credits: PLANS.standard.includedCredits, amountAgorot: 20000 },
    );
    const input = first(h.provider.checkoutInputs);
    assert.equal(input.checkoutSessionId, session.id);
    assert.equal(input.mode, "subscription");
    assert.equal(input.successUrl, `https://app.example/app/settings?checkout=success&session=${session.id}`);
    assert.equal(input.failureUrl, `https://app.example/app/settings?checkout=failed&session=${session.id}`);
    assert.equal(input.expiresAt.getTime(), NOW.getTime() + HOUR_MS);
  });

  test("is blocked only by a subscription that keeps charging", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await assert.rejects(h.service.startCheckout(USER, "standard"), AlreadySubscribedError);
    h.subscriptions.rows = [subscription({ cancelAtPeriodEnd: true })];
    await h.service.startCheckout(USER, "standard");
    h.subscriptions.rows = [subscription({ status: "canceled", cancelAtPeriodEnd: true })];
    await h.service.startCheckout(USER, "basic");
    h.subscriptions.rows = [subscription({ status: "expired" })];
    await h.service.startCheckout(USER, "pro");
    assert.equal(h.provider.checkoutInputs.length, 3);
  });

  test("an overdue standing order blocks a new one, even after its grace period; top-ups stay open while entitled", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    h.subscriptions.seed(subscription({ status: "past_due", currentPeriodEnd: NOW }));
    await h.service.startTopup(USER, 50);
    now = new Date(NOW.getTime() + 8 * DAY_MS);
    await assert.rejects(h.service.startCheckout(USER, "standard"), PaymentOverdueError);
    assert.equal(h.provider.checkoutInputs.length, 1);
  });

  test("a provider that can end an overdue order keeps the subscribe path: the new order ends the old one", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    h.provider.capabilities = { ...h.provider.capabilities, cancelWhilePastDue: true };
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_old", status: "past_due", currentPeriodEnd: NOW }));
    now = new Date(NOW.getTime() + 8 * DAY_MS);
    const session = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_new", occurredAt: now, reference: { checkoutSessionId: session.id } }));
    assert.deepEqual(h.provider.callsTo("cancelSubscription").map((c) => c.args[0]), ["sub_old"]);
  });

  test("an overdue order the provider cannot end makes an old checkout unpayable and blocks cancel without touching anything", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_ok", createdAt: at("2026-08-20T10:00:00.000Z") }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_due", status: "past_due" }));
    await assert.rejects(h.service.cancel(USER), PaymentOverdueError);
    assert.equal(h.provider.callsTo("cancelSubscription").length, 0);
    assert.equal(await h.service.isPayable(session), false);
  });

  test("a provider link finds our checkout; the provider's own transactions are not ours", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    assert.equal((await h.service.findCheckoutByProviderCheckoutId("mock", `chk_${session.id}`))?.id, session.id);
    assert.equal(await h.service.findCheckoutByProviderCheckoutId("mock", "txn_renewal"), null);
  });

  test("a checkout the provider could not create is settled as failed, so it blocks nothing", async () => {
    const h = harness();
    h.provider.createCheckout = async () => {
      throw new Error("gateway down");
    };
    await assert.rejects(h.service.startCheckout(USER, "standard"), /gateway down/);
    assert.equal(first(h.checkouts.rows).status, "failed");
    await h.service.cancelForAccountDeletion(USER.id);
  });

  test("a session stays payable while pending, until a subscription starts after it was opened", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    const abandoned = await openSubscriptionCheckout(h);
    now = new Date(NOW.getTime() + 2 * HOUR_MS);
    assert.equal(await h.service.isPayable(abandoned), true);
    const paid = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ reference: { checkoutSessionId: paid.id } }));
    assert.deepEqual({ abandoned: await h.service.isPayable(abandoned), paid: await h.service.isPayable(paid) }, { abandoned: false, paid: false });
    await h.service.startTopup(USER, 50);
    assert.equal(await h.service.isPayable(last(h.checkouts.rows)), true);
  });

  test("caps hosted pages per user per hour with a durable count", async () => {
    const h = harness();
    for (let i = 0; i < MAX_OPEN_CHECKOUTS_PER_HOUR; i++) await h.service.startCheckout(USER, "standard");
    await assert.rejects(h.service.startCheckout(USER, "standard"), TooManyCheckoutsError);
    await h.service.startCheckout({ ...USER, id: "user-2" }, "standard");
  });
});

describe("first payment", () => {
  test("creates the subscription, records the payment, settles the session, grants plan credits, caps the bot", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    const session = await openSubscriptionCheckout(h);

    assert.equal(await deliver(h, paymentSucceeded({ planCode: null, reference: { checkoutSessionId: session.id } })), "processed");

    const sub = first(h.subscriptions.rows);
    assert.deepEqual(
      { userId: sub.userId, status: sub.status, planCode: sub.planCode, customer: sub.providerCustomerId },
      { userId: USER.id, status: "active", planCode: "standard", customer: "cus_1" },
    );
    assert.equal(sub.currentPeriodEnd?.toISOString(), "2026-09-26T10:00:00.000Z");
    assert.equal(session.status, "completed");
    assert.deepEqual(h.payments.rows.map((p) => ({ userId: p.userId, subscriptionId: p.subscriptionId })), [{ userId: USER.id, subscriptionId: sub.id }]);
    const plan = h.grants.rows.find((g) => g.kind === "plan");
    assert.deepEqual({ credits: plan?.credits, sourceRef: plan?.sourceRef, expiresAt: plan?.expiresAt?.toISOString() }, { credits: PLANS.standard.includedCredits, sourceRef: "plan:mock:pay_1", expiresAt: "2026-09-29T10:00:00.000Z" });
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(PLANS.standard.includedCredits));
    assert.deepEqual({ status: h.events.rows[0]?.status, userId: h.events.rows[0]?.userId }, { status: "processed", userId: USER.id });
    const status = await h.service.getStatus(USER);
    assert.deepEqual({ paid: status.paid, plan: status.plan.code, action: status.creditsAction }, { paid: true, plan: "standard", action: "topup" });
  });

  test("a yearly plan runs a year and grants the whole year's credits up front", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    const session = await openSubscriptionCheckout(h, "standard_yearly");
    assert.deepEqual({ credits: session.credits, amount: session.amountAgorot }, { credits: PLANS.standard_yearly.includedCredits, amount: 216000 });

    await deliver(h, paymentSucceeded({ planCode: null, payment: { providerPaymentId: "pay_y1", amountAgorot: 216000, currency: "ILS" }, reference: { checkoutSessionId: session.id } }));

    const sub = first(h.subscriptions.rows);
    assert.deepEqual({ plan: sub.planCode, end: sub.currentPeriodEnd?.toISOString() }, { plan: "standard_yearly", end: "2027-08-26T10:00:00.000Z" });
    const plan = h.grants.rows.find((g) => g.kind === "plan");
    assert.deepEqual({ credits: plan?.credits, expiresAt: plan?.expiresAt?.toISOString() }, { credits: PLANS.standard_yearly.includedCredits, expiresAt: "2027-08-29T10:00:00.000Z" });
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(PLANS.standard_yearly.includedCredits));
    assert.deepEqual({ mode: first(h.provider.checkoutInputs).mode, interval: first(h.provider.checkoutInputs).interval }, { mode: "subscription", interval: "year" });
  });

  test("a yearly renewal with no session extends by a year and grants another year of credits", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ planCode: "standard_yearly", currentPeriodEnd: new Date("2027-08-26T10:00:00.000Z") }));
    await deliver(h, paymentSucceeded({ planCode: null, payment: { providerPaymentId: "pay_y2", amountAgorot: 216000, currency: "ILS" }, occurredAt: new Date("2027-08-26T09:00:00.000Z") }));
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2028-08-26T10:00:00.000Z");
    assert.equal(h.grants.rows.find((g) => g.sourceRef === "plan:mock:pay_y2")?.credits, PLANS.standard_yearly.includedCredits);
  });

  test("a yearly plan cannot be changed in the app: the prepaid year would keep running under new charges", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ planCode: "standard_yearly" }));
    await assert.rejects(h.service.changePlan(USER, "standard"), YearlyPlanChangeError);
    assert.deepEqual({ checkouts: h.checkouts.rows.length, ending: h.subscriptions.rows[0]?.cancelAtPeriodEnd }, { checkouts: 0, ending: false });
  });

  test("switching to the yearly plan of the same tier is a plan change, not a no-op", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await h.service.changePlan(USER, "standard_yearly");
    assert.deepEqual({ product: last(h.checkouts.rows).productCode, ending: h.subscriptions.rows[0]?.cancelAtPeriodEnd }, { product: "standard_yearly", ending: false });
  });

  test("a provider-reported period end is used as-is on creation", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ periodEnd: at("2026-10-01T00:00:00.000Z"), reference: { checkoutSessionId: session.id } }));
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2026-10-01T00:00:00.000Z");
  });

  test("a short or foreign-currency payment fails the event and writes nothing", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    await deliverExpectingFailure(
      h,
      paymentSucceeded({ payment: { providerPaymentId: "pay_short", amountAgorot: 19999, currency: "ILS" }, reference: { checkoutSessionId: session.id } }),
      "amount_mismatch",
    );
    await deliverExpectingFailure(
      h,
      paymentSucceeded({ payment: { providerPaymentId: "pay_usd", amountAgorot: 20000, currency: "USD" }, reference: { checkoutSessionId: session.id } }),
      "amount_mismatch",
    );
    assert.deepEqual({ payments: h.payments.rows.length, subscriptions: h.subscriptions.rows.length, grants: h.grants.rows.length }, { payments: 0, subscriptions: 0, grants: 0 });
    assert.equal(session.status, "pending");
  });

  test("an unknown plan code fails the event instead of defaulting to a paid tier", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    session.productCode = "gold";
    await deliverExpectingFailure(h, paymentSucceeded({ reference: { checkoutSessionId: session.id } }), "unknown_plan");
    assert.deepEqual({ payments: h.payments.rows.length, subscriptions: h.subscriptions.rows.length }, { payments: 0, subscriptions: 0 });
  });

  test("a renewal that arrives before its creation callback is retried and then extends the period in full", async () => {
    const h = harness();
    await deliverExpectingFailure(h, paymentSucceeded({ providerEventId: "evt_orphan" }), "unresolved_user");
    assert.deepEqual({ payments: h.payments.rows.length, subscriptions: h.subscriptions.rows.length }, { payments: 0, subscriptions: 0 });

    const session = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_create", amountAgorot: 20000, currency: "ILS" }, reference: { checkoutSessionId: session.id } }));
    assert.equal(await deliver(h, paymentSucceeded({ providerEventId: "evt_orphan" })), "processed");
    assert.equal(first(h.subscriptions.rows).currentPeriodEnd?.toISOString(), "2026-10-26T10:00:00.000Z");
    assert.deepEqual({ payments: h.payments.rows.length, grants: h.grants.rows.length, owners: h.payments.rows.map((p) => p.userId) }, { payments: 2, grants: 2, owners: [USER.id, USER.id] });
  });

  test("a one-time payment with no top-up session fails and is not turned into a subscription", async () => {
    const h = harness();
    await deliverExpectingFailure(h, paymentSucceeded({ providerSubscriptionId: null }), "missing_subscription");
    assert.deepEqual({ payments: h.payments.rows.length, subscriptions: h.subscriptions.rows.length }, { payments: 0, subscriptions: 0 });
  });

  test("a new subscription ends any other standing order the user still has", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_old" }));
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_new", reference: { checkoutSessionId: session.id } }));
    assert.deepEqual(h.provider.callsTo("cancelSubscription").map((c) => c.args[0]), ["sub_old"]);
    const old = h.subscriptions.rows.find((s) => s.providerSubscriptionId === "sub_old");
    assert.deepEqual({ ending: old?.cancelAtPeriodEnd, current: (await h.service.getStatus(USER)).subscription?.status }, { ending: true, current: "active" });
    assert.ok(h.logs.warnings.some((m) => m.includes("ended an older standing order")));
  });

  test("an older order the provider cannot end yet keeps the new credits and retries until it is ended", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_old" }));
    const cancel = h.provider.cancelSubscription;
    h.provider.cancelSubscription = async () => {
      throw new Error("provider down");
    };
    const charge = paymentSucceeded({ providerSubscriptionId: "sub_new", reference: { checkoutSessionId: session.id } });
    await deliverExpectingFailure(h, charge, "standing_order_not_ended");
    assert.equal(h.grants.rows.filter((g) => g.kind === "plan").length, 1);
    h.provider.cancelSubscription = cancel;
    assert.equal(await deliver(h, charge), "processed");
    assert.deepEqual(
      { oldEnding: h.subscriptions.rows.find((s) => s.providerSubscriptionId === "sub_old")?.cancelAtPeriodEnd, grants: h.grants.rows.filter((g) => g.kind === "plan").length },
      { oldEnding: true, grants: 1 },
    );
  });

  test("the newest order always survives: an older one that charges again is the one ended", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_older" }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_newer", createdAt: at("2026-08-27T10:00:00.000Z") }));
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_older", payment: { providerPaymentId: "pay_r", amountAgorot: 20000, currency: "ILS" } }));
    assert.deepEqual(h.provider.callsTo("cancelSubscription").map((c) => c.args[0]), ["sub_older"]);
  });

  test("an older order the provider cannot end while overdue is left to dunning, and ended by its own renewal if it recovers", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_old", status: "past_due" }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_new", createdAt: at("2026-08-27T10:00:00.000Z") }));
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_new", payment: { providerPaymentId: "pay_n", amountAgorot: 20000, currency: "ILS" } }));
    assert.equal(h.provider.callsTo("cancelSubscription").length, 0);
    assert.ok(h.logs.warnings.some((m) => m.includes("left to dunning")));
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_old", payment: { providerPaymentId: "pay_recovered", amountAgorot: 20000, currency: "ILS" } }));
    assert.deepEqual(h.provider.callsTo("cancelSubscription").map((c) => c.args[0]), ["sub_old"]);
  });
});

describe("renewal", () => {
  test("extends from the current period end, clears cancel-at-period-end, and grants a fresh allowance", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ status: "past_due", cancelAtPeriodEnd: true }));
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_2", amountAgorot: 20000, currency: "ILS" }, occurredAt: at("2026-09-25T08:00:00.000Z") }));
    const sub = first(h.subscriptions.rows);
    assert.deepEqual({ status: sub.status, ending: sub.cancelAtPeriodEnd, end: sub.currentPeriodEnd?.toISOString() }, { status: "active", ending: false, end: "2026-10-26T10:00:00.000Z" });
    assert.equal(h.grants.rows[0]?.expiresAt?.toISOString(), "2026-10-29T10:00:00.000Z");
  });

  test("a late renewal after a lapse extends from the payment time", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ currentPeriodEnd: at("2026-06-01T00:00:00.000Z") }));
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_late", amountAgorot: 20000, currency: "ILS" }, occurredAt: at("2026-08-15T00:00:00.000Z") }));
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2026-09-15T00:00:00.000Z");
  });

  test("a provider-reported period end never rewinds the stored one", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ currentPeriodEnd: at("2026-10-26T10:00:00.000Z") }));
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_old", amountAgorot: 20000, currency: "ILS" }, periodEnd: at("2026-09-26T10:00:00.000Z") }));
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2026-10-26T10:00:00.000Z");
  });

  test("a renewal carrying the plan-change session adopts the plan the user just chose", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ planCode: "basic" }));
    await h.service.changePlan(USER, "pro");
    const session = first(h.checkouts.rows);
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_up", amountAgorot: 40000, currency: "ILS" }, reference: { checkoutSessionId: session.id } }));
    assert.deepEqual({ plan: h.subscriptions.rows[0]?.planCode, ending: h.subscriptions.rows[0]?.cancelAtPeriodEnd }, { plan: "pro", ending: false });
    assert.equal(h.grants.rows[0]?.credits, PLANS.pro.includedCredits);
  });

  test("the same payment under a new event id extends nothing twice and grants once", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await deliver(h, paymentSucceeded());
    const afterFirst = first(h.subscriptions.rows).currentPeriodEnd?.toISOString();
    assert.equal(await deliver(h, paymentSucceeded()), "processed");
    assert.equal(first(h.subscriptions.rows).currentPeriodEnd?.toISOString(), afterFirst);
    assert.deepEqual({ payments: h.payments.rows.length, grants: h.grants.rows.length, note: h.events.rows[1]?.note }, { payments: 1, grants: 1, note: "duplicate_payment" });
  });

  test("a renewal short of the plan price or in another currency fails the event", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await deliverExpectingFailure(h, paymentSucceeded({ payment: { providerPaymentId: "pay_1", amountAgorot: 100, currency: "ILS" } }), "amount_mismatch");
    await deliverExpectingFailure(h, paymentSucceeded({ payment: { providerPaymentId: "pay_2", amountAgorot: 20000, currency: "USD" } }), "amount_mismatch");
    assert.deepEqual({ payments: h.payments.rows.length, grants: h.grants.rows.length, end: first(h.subscriptions.rows).currentPeriodEnd?.toISOString() }, { payments: 0, grants: 0, end: "2026-09-26T10:00:00.000Z" });
  });

  test("a renewal for the plan its charged price names adopts it, so a downgrade made at the provider is not a short payment", async () => {
    const h = harness();
    const sub = h.subscriptions.seed(subscription({ planCode: "pro" }));
    h.payments.rows.push({ userId: USER.id, subscriptionId: sub.id, provider: "mock", providerPaymentId: "pay_signup", status: "succeeded", amountAgorot: 40000, currency: "ILS", occurredAt: at("2026-07-26T10:00:00.000Z") });
    assert.equal(await deliver(h, paymentSucceeded({ planCode: "basic", payment: { providerPaymentId: "pay_basic", amountAgorot: 10000, currency: "ILS" } })), "processed");
    assert.deepEqual({ plan: first(h.subscriptions.rows).planCode, credits: last(h.grants.rows).credits }, { plan: "basic", credits: PLANS.basic.includedCredits });
    await deliverExpectingFailure(h, paymentSucceeded({ planCode: "basic", payment: { providerPaymentId: "pay_short", amountAgorot: 9999, currency: "ILS" } }), "amount_mismatch");
  });

  test("a renewal is measured against what the order last paid, so a catalogue price rise never fails loyal subscribers", async () => {
    const h = harness();
    const sub = h.subscriptions.seed(subscription());
    h.payments.rows.push({ userId: USER.id, subscriptionId: sub.id, provider: "mock", providerPaymentId: "pay_signup", status: "succeeded", amountAgorot: 15000, currency: "ILS", occurredAt: at("2026-07-26T10:00:00.000Z") });
    assert.equal(await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_r", amountAgorot: 15000, currency: "ILS" } })), "processed");
    await deliverExpectingFailure(h, paymentSucceeded({ payment: { providerPaymentId: "pay_less", amountAgorot: 14999, currency: "ILS" } }), "amount_mismatch");
  });

  test("a renewal older than a later cancellation still adds its month but never resurrects the subscription", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ status: "canceled", cancelAtPeriodEnd: true, providerUpdatedAt: at("2026-09-01T10:00:00.000Z") }));
    assert.equal(await deliver(h, paymentSucceeded({ occurredAt: at("2026-08-26T10:00:00.000Z") })), "processed");
    const sub = first(h.subscriptions.rows);
    assert.deepEqual(
      { status: sub.status, ending: sub.cancelAtPeriodEnd, updatedAt: sub.providerUpdatedAt.toISOString(), end: sub.currentPeriodEnd?.toISOString(), grants: h.grants.rows.length },
      { status: "canceled", ending: true, updatedAt: "2026-09-01T10:00:00.000Z", end: "2026-10-26T10:00:00.000Z", grants: 1 },
    );
  });

  test("two distinct renewals each add a month", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_r1", amountAgorot: 20000, currency: "ILS" } }));
    await deliver(h, paymentSucceeded({ payment: { providerPaymentId: "pay_r2", amountAgorot: 20000, currency: "ILS" }, occurredAt: at("2026-09-26T10:00:00.000Z") }));
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2026-11-26T10:00:00.000Z");
    assert.deepEqual(h.grants.rows.map((g) => g.sourceRef), ["plan:mock:pay_r1", "plan:mock:pay_r2"]);
  });

  test("a renewal that loses the period race re-reads and retries", async () => {
    const h = harness();
    const seeded = h.subscriptions.seed(subscription());
    const original = h.payments.recordRenewal.bind(h.payments);
    let raced = false;
    h.payments.recordRenewal = async (input) => {
      if (!raced) {
        raced = true;
        await h.subscriptions.updateState(seeded.id, { currentPeriodEnd: at("2026-10-26T10:00:00.000Z"), providerUpdatedAt: NOW });
      }
      return original(input);
    };
    await deliver(h, paymentSucceeded());
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2026-11-26T10:00:00.000Z");
    assert.equal(h.payments.rows.length, 1);
  });
});

describe("event inbox", () => {
  test("the same event id is a duplicate and touches nothing", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    const event = paymentSucceeded({ reference: { checkoutSessionId: session.id } });
    await deliver(h, event);
    assert.equal(await deliver(h, event), "duplicate");
    assert.deepEqual({ subs: h.subscriptions.rows.length, payments: h.payments.rows.length }, { subs: 1, payments: 1 });
  });

  test("a failed event is reprocessed on the provider's retry", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    const event = paymentSucceeded({ reference: { checkoutSessionId: session.id } });
    const original = h.payments.recordFirstPayment.bind(h.payments);
    let fail = true;
    h.payments.recordFirstPayment = async (input) => {
      if (fail) throw new Error("db down");
      return original(input);
    };
    await assert.rejects(deliver(h, event), /db down/);
    assert.deepEqual({ status: h.events.rows[0]?.status, note: h.events.rows[0]?.note }, { status: "failed", note: "db down" });
    fail = false;
    assert.equal(await deliver(h, event), "processed");
    assert.equal(h.events.rows.length, 1);
  });

  test("an event abandoned mid-flight is reclaimed once it is stale", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    const session = await openSubscriptionCheckout(h);
    const event = paymentSucceeded({ reference: { checkoutSessionId: session.id } });
    const original = h.payments.recordFirstPayment.bind(h.payments);
    h.payments.recordFirstPayment = () => new Promise(() => {});
    void deliver(h, event).catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.events.rows[0]?.status, "received");

    h.payments.recordFirstPayment = original;
    await assert.rejects(deliver(h, event), WebhookInFlightError);
    now = new Date(NOW.getTime() + 11 * 60 * 1000);
    assert.equal(await deliver(h, event), "processed");
  });

  test("a poison event is acknowledged after MAX_EVENT_ATTEMPTS deliveries", async () => {
    const h = harness();
    const event = paymentSucceeded({ providerEventId: "evt_poison" });
    for (let attempt = 1; attempt <= MAX_EVENT_ATTEMPTS; attempt++) await assert.rejects(deliver(h, event), /unresolved_user/);
    assert.equal(await deliver(h, event), "duplicate");
    assert.deepEqual({ status: first(h.events.rows).status, attempts: first(h.events.rows).attempts }, { status: "failed", attempts: MAX_EVENT_ATTEMPTS });
  });

  test("verification failures propagate before anything is written", async () => {
    const h = harness();
    h.provider.nextEvent = new WebhookVerificationError("bad signature");
    await assert.rejects(h.service.handleWebhook("mock", emptyRequest), WebhookVerificationError);
    assert.equal(h.events.rows.length, 0);
  });

  test("unknown or disabled providers answer 404", async () => {
    await assert.rejects(harness().service.handleWebhook("stripe", emptyRequest), UnknownProviderError);
    await assert.rejects(harness({ providerAvailable: false }).service.handleWebhook("mock", emptyRequest), UnknownProviderError);
  });

  test("ignored events are recorded and acknowledged", async () => {
    const h = harness();
    assert.equal(await deliver(h, { kind: "ignored", providerEventId: "evt_x", eventType: "ping", occurredAt: NOW, payload: {} }), "ignored");
    assert.equal(h.events.rows[0]?.status, "ignored");
  });

  test("with a background runner the re-cap leaves the response path and still runs", async () => {
    const deferred: Promise<unknown>[] = [];
    const h = harness({ background: (work) => void deferred.push(work) });
    h.llm.addBot(USER.id, BOT_ID);
    const session = await openSubscriptionCheckout(h);
    assert.equal(await deliver(h, paymentSucceeded({ reference: { checkoutSessionId: session.id } })), "processed");
    assert.equal(deferred.length, 1);
    await Promise.all(deferred);
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(PLANS.standard.includedCredits));
  });

  test("a gateway outage after the ledger is written does not fail the event", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    h.llm.failReadsFor.add(BOT_ID);
    const session = await openSubscriptionCheckout(h);
    assert.equal(await deliver(h, paymentSucceeded({ reference: { checkoutSessionId: session.id } })), "processed");
    assert.equal(h.grants.rows.length, 1);
  });
});

describe("failed charges and cancellations", () => {
  test("a failed charge moves to past_due with a grace period and records the attempt", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await deliver(h, failedCharge());
    assert.deepEqual({ status: h.subscriptions.rows[0]?.status, payment: h.payments.rows[0]?.status }, { status: "past_due", payment: "failed" });
    assert.equal((await h.service.getStatus(USER)).reason, "grace_period");
  });

  test("an older failure or cancellation never regresses a newer state", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ providerUpdatedAt: at("2026-08-27T00:00:00.000Z") }));
    await deliver(h, failedCharge({ occurredAt: at("2026-08-26T00:00:00.000Z") }));
    await deliver(h, canceled({ occurredAt: at("2026-08-26T00:00:00.000Z") }));
    assert.equal(h.subscriptions.rows[0]?.status, "active");
    assert.deepEqual(h.events.rows.map((e) => e.note), ["stale_event", "stale_event"]);
  });

  test("a failure on a settled subscription is noted, not applied", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ status: "canceled", cancelAtPeriodEnd: true }));
    await deliver(h, failedCharge({ payment: null }));
    assert.deepEqual({ status: h.subscriptions.rows[0]?.status, note: h.events.rows[0]?.note }, { status: "canceled", note: "already_settled" });
  });

  test("failure and cancellation for an unknown subscription are retried later", async () => {
    const h = harness();
    await deliverExpectingFailure(h, failedCharge(), "unknown_subscription");
    await deliverExpectingFailure(h, canceled(), "unknown_subscription");
  });

  test("cancellation keeps access until the period end and honours the provider's end date", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await deliver(h, canceled({ accessEndsAt: at("2026-09-30T00:00:00.000Z") }));
    const status = await h.service.getStatus(USER);
    assert.deepEqual(
      { status: status.subscription?.status, ending: status.subscription?.cancelAtPeriodEnd, end: status.subscription?.currentPeriodEnd, reason: status.reason, paid: status.paid },
      { status: "canceled", ending: true, end: "2026-09-30T00:00:00.000Z", reason: "canceled_until_period_end", paid: true },
    );
  });

  test("checkout.failed settles the session and creates nothing", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    const outcome = await deliver(h, { kind: "checkout.failed", providerEventId: nextEventId(), eventType: "checkout.failed", occurredAt: NOW, payload: {}, reason: "card_declined", reference: { checkoutSessionId: session.id } });
    assert.deepEqual({ outcome, session: session.status, subs: h.subscriptions.rows.length }, { outcome: "processed", session: "failed", subs: 0 });
  });
});

describe("snapshots", () => {
  test("honour provider ordering and settle the referenced session", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    await deliver(h, snapshot("2026-08-20T00:00:00.000Z", "canceled", session.id));
    await deliver(h, snapshot("2026-08-10T00:00:00.000Z", "active"));
    assert.deepEqual({ status: h.subscriptions.rows[0]?.status, session: session.status, note: h.events.rows[1]?.note }, { status: "canceled", session: "completed", note: "stale_event" });
  });

  test("a snapshot with no owner is retried later", async () => {
    await deliverExpectingFailure(harness(), snapshot("2026-08-20T00:00:00.000Z", "active"), "unresolved_user");
  });

  test("an older order the provider itself reports overdue is left to dunning instead of failing the charge", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_old" }));
    h.provider.cancelSubscription = async () => {
      throw new PaymentOverdueError();
    };
    await h.service.changePlan(USER, "pro");
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_new", payment: { providerPaymentId: "pay_pro", amountAgorot: 40000, currency: "ILS" }, reference: { checkoutSessionId: last(h.checkouts.rows).id } }));
    assert.deepEqual({ status: last(h.events.rows).status, grants: h.grants.rows.length }, { status: "processed", grants: 1 });
    assert.ok(h.logs.warnings.some((m) => m.includes("left to dunning")));
  });

  test("a deleted account's subscription still follows its provider state", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ userId: null }));
    assert.equal(await deliver(h, snapshot("2026-08-27T10:00:00.000Z", "canceled")), "processed");
    assert.deepEqual({ status: h.subscriptions.rows[0]?.status, note: last(h.events.rows).note }, { status: "canceled", note: "account_deleted" });
  });

  test("a plan change ends the old order once the new order's charge lands, even when its snapshot came first", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ id: "old", providerSubscriptionId: "sub_old" }));
    await h.service.changePlan(USER, "pro");
    const session = last(h.checkouts.rows);
    await deliver(h, snapshot("2026-08-26T10:00:00.000Z", "active", session.id));
    assert.equal(h.subscriptions.rows.find((s) => s.id === "old")?.cancelAtPeriodEnd, false);
    await deliver(h, paymentSucceeded({ planCode: null, payment: { providerPaymentId: "pay_pro", amountAgorot: 40000, currency: "ILS" }, periodEnd: at("2026-09-26T10:00:00.000Z"), reference: { checkoutSessionId: session.id } }));
    assert.equal(h.subscriptions.rows.find((s) => s.id === "old")?.cancelAtPeriodEnd, true);
  });

  test("lifecycle providers deliver in any order: snapshot then charge makes one subscription, one period, one grant", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    const periodEnd = at("2026-09-26T10:00:00.000Z");
    await deliver(h, snapshot("2026-08-26T10:00:00.000Z", "active", session.id));
    await deliver(h, paymentSucceeded({ planCode: null, periodEnd, reference: { checkoutSessionId: session.id } }));
    await deliver(h, paymentSucceeded({ planCode: null, periodEnd, reference: { checkoutSessionId: session.id } }));
    assert.deepEqual(
      { subs: h.subscriptions.rows.length, end: h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), grants: h.grants.rows.filter((g) => g.kind === "plan").length, payments: h.payments.rows.length },
      { subs: 1, end: periodEnd.toISOString(), grants: 1, payments: 1 },
    );
  });
});

describe("refunds", () => {
  const refunded = (overrides: Partial<Extract<ProviderEvent, { kind: "payment.refunded" }>> = {}): ProviderEvent => ({
    kind: "payment.refunded",
    providerEventId: nextEventId(),
    eventType: "adjustment.updated",
    occurredAt: NOW,
    payload: {},
    providerPaymentId: "pay_1",
    providerSubscriptionId: "sub_1",
    full: true,
    reference: { checkoutSessionId: null },
    ...overrides,
  });

  test("a full refund marks the payment and takes back only the unspent credits of that charge", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    const session = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ planCode: null, reference: { checkoutSessionId: session.id } }));
    const plan = h.grants.rows.find((g) => g.kind === "plan")!;
    plan.usedCredits = 100;
    assert.equal(await deliver(h, refunded()), "processed");
    assert.equal(await deliver(h, refunded()), "processed");
    assert.deepEqual({ credits: plan.credits, used: plan.usedCredits, payment: h.payments.rows[0]?.status }, { credits: 100, used: 100, payment: "refunded" });
    assert.equal(h.llm.lastCeiling(BOT_ID), 0);
  });

  test("a partial refund changes nothing and is left for a human; a refund ahead of its charge retries", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ planCode: null, reference: { checkoutSessionId: session.id } }));
    await deliver(h, refunded({ full: false }));
    assert.deepEqual({ credits: h.grants.rows[0]?.credits, payment: h.payments.rows[0]?.status, note: last(h.events.rows).note }, { credits: PLANS.standard.includedCredits, payment: "succeeded", note: "partial_refund" });
    await deliverExpectingFailure(h, refunded({ providerPaymentId: "pay_unknown" }), "unknown_payment");
  });

  test("a refund of a deleted account's payment is recorded and acknowledged", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    await deliver(h, paymentSucceeded({ reference: { checkoutSessionId: session.id } }));
    h.payments.rows[0]!.userId = null;
    h.grants.rows = [];
    assert.equal(await deliver(h, refunded()), "processed");
    assert.equal(h.payments.rows[0]?.status, "refunded");
  });

  test("a refunded top-up takes back its unspent credits", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await h.service.startTopup(USER, 50);
    const session = last(h.checkouts.rows);
    await deliver(h, paymentSucceeded({ providerSubscriptionId: null, payment: { providerPaymentId: "pay_top", amountAgorot: 5000, currency: "ILS" }, reference: { checkoutSessionId: session.id } }));
    await deliver(h, refunded({ providerPaymentId: "pay_top", providerSubscriptionId: null }));
    assert.deepEqual(h.grants.rows.map((g) => ({ kind: g.kind, credits: g.credits })), [{ kind: "topup", credits: 0 }]);
  });
});

describe("top-ups", () => {
  test("require a paid subscription and a whole amount inside the allowed range", async () => {
    const h = harness();
    await assert.rejects(h.service.startTopup(USER, 50), NoSubscriptionError);
    h.subscriptions.seed(subscription());
    await assert.rejects(h.service.startTopup(USER, 19), InvalidTopupAmountError);
    await assert.rejects(h.service.startTopup(USER, 501), InvalidTopupAmountError);
    await assert.rejects(h.service.startTopup(USER, 49.5), InvalidTopupAmountError);
    await h.service.startTopup(USER, 50);
    const session = first(h.checkouts.rows);
    assert.deepEqual(
      { kind: session.kind, credits: session.credits, amountAgorot: session.amountAgorot, productCode: session.productCode, mode: h.provider.checkoutInputs[0]?.mode },
      { kind: "topup", credits: creditsForTopupIls(50), amountAgorot: 5000, productCode: "topup_ils_50", mode: "one_time" },
    );
  });

  test("a paid top-up grants perpetual credits, records the payment, and leaves the subscription alone", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    h.llm.addBot(USER.id, BOT_ID);
    await h.service.startTopup(USER, 125);
    const session = first(h.checkouts.rows);
    await deliver(h, paymentSucceeded({ providerSubscriptionId: null, planCode: null, payment: { providerPaymentId: "pay_t1", amountAgorot: 12500, currency: "ILS" }, reference: { checkoutSessionId: session.id } }));
    assert.equal(session.status, "completed");
    assert.equal(h.subscriptions.rows[0]?.currentPeriodEnd?.toISOString(), "2026-09-26T10:00:00.000Z");
    assert.deepEqual({ userId: h.payments.rows[0]?.userId, subscriptionId: h.payments.rows[0]?.subscriptionId }, { userId: USER.id, subscriptionId: null });
    const topup = first(h.grants.rows);
    assert.deepEqual({ kind: topup.kind, credits: topup.credits, sourceRef: topup.sourceRef, expiresAt: topup.expiresAt }, { kind: "topup", credits: creditsForTopupIls(125), sourceRef: "topup:mock:pay_t1", expiresAt: null });
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(creditsForTopupIls(125)));
  });

  test("a redelivered top-up grants nothing twice", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await h.service.startTopup(USER, 50);
    const session = first(h.checkouts.rows);
    const event = () => paymentSucceeded({ providerSubscriptionId: null, planCode: null, payment: { providerPaymentId: "pay_t1", amountAgorot: 5000, currency: "ILS" }, reference: { checkoutSessionId: session.id } });
    await deliver(h, event());
    await deliver(h, event());
    assert.deepEqual({ grants: h.grants.rows.length, note: h.events.rows[1]?.note }, { grants: 1, note: "duplicate_payment" });
  });

  test("a short top-up or one that carries a subscription id fails the event", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await h.service.startTopup(USER, 50);
    const session = first(h.checkouts.rows);
    await deliverExpectingFailure(h, paymentSucceeded({ providerSubscriptionId: null, payment: { providerPaymentId: "pay_a", amountAgorot: 4999, currency: "ILS" }, reference: { checkoutSessionId: session.id } }), "amount_mismatch");
    await deliverExpectingFailure(h, paymentSucceeded({ providerSubscriptionId: "sub_x", payment: { providerPaymentId: "pay_b", amountAgorot: 5000, currency: "ILS" }, reference: { checkoutSessionId: session.id } }), "topup_with_subscription");
    assert.deepEqual({ grants: h.grants.rows.length, payments: h.payments.rows.length }, { grants: 0, payments: 0 });
  });

  test("a declined top-up settles its session as failed", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await h.service.startTopup(USER, 50);
    const session = first(h.checkouts.rows);
    await deliver(h, failedCharge({ providerSubscriptionId: null, payment: null, reference: { checkoutSessionId: session.id } }));
    assert.deepEqual({ session: session.status, note: h.events.rows[0]?.note }, { session: "failed", note: "topup_failed" });
  });
});

describe("cancel, resume, plan change", () => {
  test("cancel derives the state when the provider returns no snapshot and is idempotent", async () => {
    const h = harness();
    await assert.rejects(h.service.cancel(USER), NoSubscriptionError);
    h.subscriptions.seed(subscription());
    const status = await h.service.cancel(USER);
    assert.deepEqual({ status: status.subscription?.status, ending: status.subscription?.cancelAtPeriodEnd, paid: status.paid }, { status: "canceled", ending: true, paid: true });
    await h.service.cancel(USER);
    assert.equal(h.provider.callsTo("cancelSubscription").length, 1);
  });

  test("cancel and resume apply the provider snapshot when one is returned", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    const providerSnapshot = (cancelAtPeriodEnd: boolean) => ({
      providerSubscriptionId: "sub_1",
      providerCustomerId: "cus_1",
      planCode: "standard",
      status: "active" as const,
      cancelAtPeriodEnd,
      currentPeriodEnd: at("2026-09-30T00:00:00.000Z"),
      trialEndsAt: null,
      providerUpdatedAt: new Date(NOW.getTime() + 1000),
    });
    h.provider.cancelResult = providerSnapshot(true);
    assert.equal((await h.service.cancel(USER)).subscription?.cancelAtPeriodEnd, true);
    h.provider.resumeResult = providerSnapshot(false);
    const resumed = await h.service.resume(USER);
    assert.deepEqual({ ending: resumed.subscription?.cancelAtPeriodEnd, end: resumed.subscription?.currentPeriodEnd }, { ending: false, end: "2026-09-30T00:00:00.000Z" });
  });

  test("resume without a snapshot clears cancel-at-period-end and is idempotent", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ status: "canceled", cancelAtPeriodEnd: true }));
    const status = await h.service.resume(USER);
    assert.deepEqual({ status: status.subscription?.status, ending: status.subscription?.cancelAtPeriodEnd }, { status: "active", ending: false });
    await h.service.resume(USER);
    assert.equal(h.provider.callsTo("resumeSubscription").length, 1);
  });

  test("operations respect provider capabilities", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ cancelAtPeriodEnd: true }));
    h.provider.capabilities = { cancel: false, resume: false, customerPortal: false, updatePaymentMethod: false, cancelWhilePastDue: true };
    await assert.rejects(h.service.resume(USER), UnsupportedBillingOperationError);
    await assert.rejects(h.service.getCustomerPortalUrl(USER), UnsupportedBillingOperationError);
    await assert.rejects(h.service.getUpdatePaymentMethodUrl(USER), UnsupportedBillingOperationError);
  });

  test("portal and payment-method urls come from the subscription's provider", async () => {
    const h = harness();
    await assert.rejects(h.service.getCustomerPortalUrl(USER), NoSubscriptionError);
    h.subscriptions.seed(subscription());
    assert.equal(await h.service.getCustomerPortalUrl(USER), "https://portal.example/abc");
    assert.equal(await h.service.getUpdatePaymentMethodUrl(USER), "https://update.example/abc");
    assert.deepEqual(h.provider.callsTo("getUpdatePaymentMethodUrl")[0]?.args, ["sub_1", "https://app.example/app/settings"]);
    h.provider.portalUrl = null;
    await assert.rejects(h.service.getCustomerPortalUrl(USER), UnsupportedBillingOperationError);
  });

  test("changePlan opens a checkout for the new tier and leaves the current order running until it is paid", async () => {
    const h = harness();
    await assert.rejects(h.service.changePlan(USER, "pro"), NoSubscriptionError);
    h.subscriptions.seed(subscription());
    await assert.rejects(h.service.changePlan(USER, "standard"), SamePlanError);
    await h.service.changePlan(USER, "pro");
    assert.deepEqual({ cancels: h.provider.callsTo("cancelSubscription").length, ending: h.subscriptions.rows[0]?.cancelAtPeriodEnd }, { cancels: 0, ending: false });
    const session = first(h.checkouts.rows);
    assert.deepEqual({ kind: session.kind, productCode: session.productCode, credits: session.credits, amount: session.amountAgorot }, { kind: "subscription", productCode: "pro", credits: PLANS.pro.includedCredits, amount: 40000 });
  });

  test("changePlan refuses before touching the provider when the checkout limit is reached", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ cancelAtPeriodEnd: true }));
    for (let i = 0; i < MAX_OPEN_CHECKOUTS_PER_HOUR; i++) await h.service.changePlan(USER, "pro");
    h.subscriptions.rows = [subscription()];
    await assert.rejects(h.service.changePlan(USER, "pro"), TooManyCheckoutsError);
    assert.deepEqual({ cancels: h.provider.callsTo("cancelSubscription").length, ending: first(h.subscriptions.rows).cancelAtPeriodEnd }, { cancels: 0, ending: false });
  });

  test("a plan change is refused, and its open checkout unpayable, in the hours before the current order renews", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    h.subscriptions.seed(subscription({ currentPeriodEnd: at("2026-09-26T10:00:00.000Z") }));
    await h.service.changePlan(USER, "pro");
    const session = last(h.checkouts.rows);
    assert.equal(await h.service.isPayable(session), true);
    now = at("2026-09-26T08:30:00.000Z");
    await assert.rejects(h.service.changePlan(USER, "basic"), RenewalImminentError);
    assert.equal(await h.service.isPayable(session), false);
  });

  test("changePlan is refused while the current order is overdue", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ status: "past_due" }));
    await assert.rejects(h.service.changePlan(USER, "pro"), PaymentOverdueError);
    assert.equal(h.checkouts.rows.length, 0);
  });

  test("cancel ends every standing order the user still has", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_a" }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "sub_b", createdAt: at("2026-08-27T10:00:00.000Z") }));
    await h.service.cancel(USER);
    assert.deepEqual(h.provider.callsTo("cancelSubscription").map((c) => c.args[0]).sort(), ["sub_a", "sub_b"]);
    assert.ok(h.subscriptions.rows.every((s) => s.cancelAtPeriodEnd));
  });

  test("changePlan on an already-ending subscription cancels nothing and allows any tier, including the same one", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ planCode: "pro", cancelAtPeriodEnd: true }));
    await h.service.changePlan(USER, "pro");
    assert.equal(h.provider.callsTo("cancelSubscription").length, 0);
    assert.equal(h.checkouts.rows[0]?.productCode, "pro");
  });

  test("the new tier's first payment becomes the current subscription with its own allowance", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    await h.service.changePlan(USER, "pro");
    const session = first(h.checkouts.rows);
    await deliver(h, paymentSucceeded({ providerSubscriptionId: "sub_2", payment: { providerPaymentId: "pay_pro", amountAgorot: 40000, currency: "ILS" }, reference: { checkoutSessionId: session.id } }));
    const status = await h.service.getStatus(USER);
    assert.deepEqual({ plan: status.plan.code, status: status.subscription?.status, credits: h.grants.rows[0]?.credits }, { plan: "pro", status: "active", credits: PLANS.pro.includedCredits });
  });
});

describe("account deletion", () => {
  test("cancels every charging subscription and skips settled or already-ending ones", async () => {
    const h = harness();
    await h.service.cancelForAccountDeletion(USER.id);
    h.subscriptions.seed(subscription({ providerSubscriptionId: "a" }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "b", status: "expired" }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "c", cancelAtPeriodEnd: true }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "d" }));
    await h.service.cancelForAccountDeletion(USER.id);
    assert.deepEqual(h.provider.callsTo("cancelSubscription").map((c) => c.args[0]).sort(), ["a", "d"]);
    assert.equal(h.subscriptions.rows.filter((s) => s.status === "active" && !s.cancelAtPeriodEnd).length, 0);
  });

  test("an overdue order the provider cannot end blocks the deletion before anything is cancelled", async () => {
    const h = harness();
    h.subscriptions.seed(subscription({ providerSubscriptionId: "a", createdAt: at("2026-08-20T10:00:00.000Z") }));
    h.subscriptions.seed(subscription({ providerSubscriptionId: "b", status: "past_due" }));
    await assert.rejects(h.service.cancelForAccountDeletion(USER.id), PaymentOverdueError);
    assert.equal(h.provider.callsTo("cancelSubscription").length, 0);
  });

  test("waits for a pending checkout to settle before the account can go", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    await openSubscriptionCheckout(h);
    await assert.rejects(h.service.cancelForAccountDeletion(USER.id), PendingCheckoutError);
    now = new Date(NOW.getTime() + 2 * HOUR_MS);
    await h.service.cancelForAccountDeletion(USER.id);
  });

  test("aborts when the provider errors, but proceeds locally when billing is unconfigured", async () => {
    const h = harness();
    h.subscriptions.seed(subscription());
    h.provider.cancelSubscription = async () => {
      throw new Error("provider down");
    };
    await assert.rejects(h.service.cancelForAccountDeletion(USER.id), /provider down/);
    assert.equal(h.subscriptions.rows[0]?.status, "active");

    const unconfigured = harness({ providerAvailable: false });
    unconfigured.subscriptions.seed(subscription());
    await unconfigured.service.cancelForAccountDeletion(USER.id);
    assert.equal(unconfigured.subscriptions.rows[0]?.status, "canceled");
    assert.ok(unconfigured.logs.errors.some((m) => m.includes("cancelling locally")));
  });
});

describe("status and entitlement", () => {
  const usedTrial = () => grant({ kind: "trial", credits: 400, usedCredits: 400, expiresAt: new Date(NOW.getTime() - 1) });

  test("reflects enforcement, beta access and provider availability", async () => {
    const relaxed = harness({ enforcement: false });
    relaxed.grants.rows.push(usedTrial());
    const open = await relaxed.service.getStatus(USER);
    assert.deepEqual({ entitled: open.entitled, reason: open.reason, paid: open.paid, action: open.creditsAction, sub: open.subscription }, { entitled: true, reason: "enforcement_disabled", paid: false, action: "subscribe", sub: null });

    const strict = harness({ enforcement: true });
    strict.grants.rows.push(usedTrial());
    const closed = await strict.service.getStatus(USER);
    assert.deepEqual({ entitled: closed.entitled, reason: closed.reason, action: closed.creditsAction }, { entitled: false, reason: "no_subscription", action: "subscribe" });
    assert.equal(await strict.service.isEntitled({ ...USER, betaAccess: true }), true);
    const offline = await harness({ providerAvailable: false }).service.getStatus(USER);
    assert.deepEqual({ available: offline.available, action: offline.creditsAction }, { available: false, action: "contact" });
  });

  test("refreshStatus falls back to the ledger when the gateway is unreachable", async () => {
    const h = harness();
    h.grants.rows.push(grant());
    h.llm.listLiveBotIds = async () => {
      throw new Error("orchestrator down");
    };
    const status = await h.service.refreshStatus(USER);
    assert.equal(status.credits.stale, true);
    assert.ok(h.logs.errors.some((m) => m.includes("credit refresh failed")));
  });

  test("bot creation starts the trial before the container and caps it after", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    assert.equal(await h.service.isEntitled(USER), true);
    await h.service.beforeBotCreate(USER);
    assert.equal(h.grants.rows[0]?.kind, "trial");
    await h.service.afterBotCreated(USER.id);
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(TRIAL_CREDITS));
    assert.equal((await h.service.getStatus(USER)).reason, "trial");
    await h.service.beforeBotCreate(USER);
    assert.equal(h.grants.rows.length, 1);
  });

  test("a used-up trial with no subscription is not entitled under enforcement, and cannot create a bot", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    await h.service.beforeBotCreate(USER);
    now = new Date(NOW.getTime() + (TRIAL_DAYS + 1) * DAY_MS);
    assert.equal(await h.service.isEntitled(USER), false);
    assert.equal((await h.service.getStatus(USER)).reason, "no_subscription");
    await assert.rejects(h.service.beforeBotCreate(USER), TrialUnavailableError);
    h.subscriptions.seed(subscription({ currentPeriodEnd: new Date(now.getTime() + DAY_MS) }));
    await h.service.beforeBotCreate(USER);
  });

  test("a deleted account's trial claim still blocks the same mailbox, and a lost claim race grants nothing", async () => {
    const h = harness();
    await h.service.beforeBotCreate(USER);
    h.trialClaims.forgetUser(USER.id);
    h.grants.rows = [];
    const again = { ...USER, id: "user-2" };
    assert.equal(await h.service.isEntitled(again), false);
    await assert.rejects(h.service.beforeBotCreate(again), TrialUnavailableError);

    const racer = { ...USER, id: "user-3", email: "fresh@example.com" };
    h.trialClaims.claim = async () => false;
    await assert.rejects(h.service.beforeBotCreate(racer), TrialUnavailableError);
    assert.equal(h.grants.rows.length, 0);
  });

  test("every first bot starts the trial except a paying user's; beta and enforcement-off users get it too", async () => {
    const beta = harness();
    await beta.service.beforeBotCreate({ ...USER, betaAccess: true });
    assert.deepEqual({ grants: beta.grants.rows.map((g) => g.kind), claims: beta.trialClaims.rows.size }, { grants: ["trial"], claims: 1 });

    const open = harness({ enforcement: false });
    await open.service.beforeBotCreate(USER);
    assert.deepEqual(open.grants.rows.map((g) => g.kind), ["trial"]);

    const paid = harness();
    paid.subscriptions.seed(subscription());
    await paid.service.beforeBotCreate(USER);
    assert.deepEqual({ grants: paid.grants.rows.length, claims: paid.trialClaims.rows.size }, { grants: 0, claims: 0 });

    const trialing = harness();
    await trialing.service.beforeBotCreate(USER);
    await trialing.service.beforeBotCreate(USER);
    assert.equal(trialing.grants.rows.length, 1);
  });

  test("a beta user whose mailbox already had its trial may still create a bot, metered with no credits", async () => {
    const h = harness();
    await h.service.beforeBotCreate(USER);
    const alias = { ...USER, id: "user-2", email: "U+beta@example.com", betaAccess: true };
    h.llm.addBot(alias.id, BOT_ID, { spendUsdCents: 40 });
    await h.service.beforeBotCreate(alias);
    await h.service.afterBotCreated(alias.id);
    assert.deepEqual(
      { grants: h.grants.rows.filter((g) => g.userId === alias.id).length, ceiling: h.llm.lastCeiling(BOT_ID) },
      { grants: 0, ceiling: 40 },
    );
    await assert.rejects(h.service.beforeBotCreate({ ...alias, betaAccess: false }), TrialUnavailableError);
  });

  test("a mailbox that already had a trial under another account gets none, plus-tags and dots included", async () => {
    const h = harness();
    await h.service.beforeBotCreate(USER);
    const again = { ...USER, id: "user-2", email: "U+promo@Example.com" };
    assert.equal(await h.service.isEntitled(again), false);
    assert.deepEqual({ reason: (await h.service.getStatus(again)).reason, trial: (await h.service.getStatus(again)).credits.trial }, { reason: "no_subscription", trial: { kind: "used" } });
    await assert.rejects(h.service.beforeBotCreate(again), TrialUnavailableError);
    assert.equal(h.grants.rows.length, 1);
    assert.equal(await h.service.isEntitled({ ...USER, id: "user-3", email: "other@example.com" }), true);
  });

  test("deleting a bot charges its spend first and refuses when the gateway cannot be read", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    await h.service.beforeBotCreate(USER);
    await h.service.afterBotCreated(USER.id);
    h.llm.setSpend(BOT_ID, { spendUsdCents: 100 });
    await h.service.beforeBotDelete(USER.id, BOT_ID);
    assert.equal(h.grants.rows[0]?.usedCredits, 200);

    h.llm.failReadsFor.add(BOT_ID);
    await assert.rejects(h.service.beforeBotDelete(USER.id, BOT_ID), /gateway unreachable/);
  });

  test("a bot whose owner has no credits is capped at its spend and reads as out of credits", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 300, maxBudgetUsdCents: 1000 });
    const status = await h.service.refreshStatus(USER);
    assert.deepEqual(
      { ceiling: h.llm.lastCeiling(BOT_ID), balance: status.credits.balance, reason: status.reason },
      { ceiling: 300, balance: { kind: "out", reason: "credits-spent" }, reason: "trial_available" },
    );
  });

  test("findCheckoutSession is owner-scoped", async () => {
    const h = harness();
    const session = await openSubscriptionCheckout(h);
    assert.ok(await h.service.findCheckoutSession(USER, session.id));
    assert.equal(await h.service.findCheckoutSession({ ...USER, id: "someone-else" }, session.id), null);
  });
});

describe("admin grant", () => {
  test("tops up a trial user, raises the bot's cap at once, and survives the trial's expiry", async () => {
    let now = NOW;
    const h = harness({ now: () => now });
    h.llm.addBot(USER.id, BOT_ID);
    await h.service.beforeBotCreate(USER);
    await h.service.afterBotCreated(USER.id);

    const ref = "5f0f2c6a-9d3b-4e8a-b1c2-7d4e5f6a7b8c";
    const summary = await h.service.grantCreditsByAdmin(USER.id, 1000, ref, "admin-1");
    assert.equal(summary.available, TRIAL_CREDITS + 1000);
    assert.equal(h.llm.lastCeiling(BOT_ID), usdCentsFromCredits(TRIAL_CREDITS + 1000));
    assert.deepEqual([last(h.grants.rows).kind, last(h.grants.rows).sourceRef], ["topup", `admin:${ref}`]);

    const replayed = await h.service.grantCreditsByAdmin(USER.id, 1000, ref, "admin-1");
    assert.equal(replayed.available, TRIAL_CREDITS + 1000);
    assert.equal(h.grants.rows.length, 2);

    now = new Date(NOW.getTime() + (TRIAL_DAYS + 1) * DAY_MS);
    const after = await h.service.refreshStatus(USER);
    assert.equal(after.credits.available, 1000);
    assert.equal(after.credits.trial.kind, "used");
  });

  test("a failed sync after the grant returns the ledger flagged stale instead of throwing", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    await h.service.beforeBotCreate(USER);
    h.llm.listLiveBotIds = async () => {
      throw new Error("orchestrator down");
    };
    const summary = await h.service.grantCreditsByAdmin(USER.id, 1000, "5f0f2c6a-9d3b-4e8a-b1c2-7d4e5f6a7b8d", "admin-1");
    assert.deepEqual([summary.stale, summary.available, h.grants.rows.length], [true, TRIAL_CREDITS + 1000, 2]);
  });

  test("tops up a user who has no credits at all, charging only spend after the grant and keeping the trial", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID, { spendUsdCents: 300 });
    await h.service.refreshStatus(USER);
    const summary = await h.service.grantCreditsByAdmin(USER.id, 1000, "5f0f2c6a-9d3b-4e8a-b1c2-7d4e5f6a7b8c", "admin-1");
    assert.deepEqual(
      { available: summary.available, ceiling: h.llm.lastCeiling(BOT_ID), trial: summary.trial },
      { available: 1000, ceiling: 300 + usdCentsFromCredits(1000), trial: { kind: "available" } },
    );
  });

  test("reads ledgers for many users in one pass, one summary per requested user", async () => {
    const h = harness();
    h.llm.addBot(USER.id, BOT_ID);
    await h.service.beforeBotCreate(USER);
    const summaries = await h.service.creditSummaries([USER.id, "user-2"]);
    assert.deepEqual([...summaries.keys()], [USER.id, "user-2"]);
    assert.equal(summaries.get(USER.id)?.available, TRIAL_CREDITS);
    assert.deepEqual(summaries.get("user-2")?.balance, { kind: "none" });
  });
});

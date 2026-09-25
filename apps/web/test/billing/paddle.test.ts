import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BillingUnavailableError,
  MalformedWebhookError,
  PaymentDeclinedError,
  PaymentOverdueError,
  PaymentProviderError,
  RenewalImminentError,
  WebhookVerificationError,
} from "../../src/lib/billing/errors";
import { signBody } from "../../src/lib/billing/provider/hmac";
import type { CreateCheckoutInput, WebhookRequest } from "../../src/lib/billing/provider/types";
import { PADDLE_PAY_PATH, PaddlePaymentProvider } from "../../src/lib/billing/providers/paddle/adapter";
import { readPaddleConfig, type PaddleConfig } from "../../src/lib/billing/providers/paddle/config";
import { CHECKOUT_SESSION_KEY, PRICE_PLAN_KEY } from "../../src/lib/billing/providers/paddle/wire";
import { PLAN_CODES, type PlanCode } from "../../src/lib/billing/pricing";

const NOW = new Date("2026-09-25T10:00:00.000Z");
const SECRET = "pdl_ntfset_secret_for_tests";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PRICE_IDS = new Map<PlanCode, string>(PLAN_CODES.map((code, i) => [code, `pri_${code.replace("_", "")}${i}`]));

const CONFIG: PaddleConfig = {
  environment: "sandbox",
  apiKey: "pdl_sdbx_apikey_test",
  webhookSecret: SECRET,
  priceIds: PRICE_IDS,
  topupProductId: "pro_topup",
  clientToken: "test_client_token",
  appUrl: "https://app.example",
};

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, impl };
}

function provider(responses: Array<{ status: number; body: unknown }> = []) {
  const fake = fakeFetch(responses);
  return { adapter: new PaddlePaymentProvider(CONFIG, { fetch: fake.impl, now: () => NOW }), calls: fake.calls };
}

function signed(body: unknown, at: Date = NOW, secret = SECRET): WebhookRequest {
  const rawBody = JSON.stringify(body);
  const ts = Math.floor(at.getTime() / 1000);
  const header = `ts=${ts};h1=${signBody(secret, `${ts}:${rawBody}`)}`;
  return { rawBody, header: (name) => (name.toLowerCase() === "paddle-signature" ? header : null) };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "txn_1",
    status: "completed",
    customer_id: "ctm_1",
    subscription_id: "sub_1",
    custom_data: { [CHECKOUT_SESSION_KEY]: SESSION_ID },
    currency_code: "ILS",
    origin: "api",
    billing_period: { starts_at: "2026-09-25T10:00:00.000000Z", ends_at: "2026-10-25T10:00:00.000000Z" },
    items: [{ price: { id: PRICE_IDS.get("standard") } }],
    details: { totals: { total: "20000" } },
    ...overrides,
  };
}

function subscriptionData(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    custom_data: { [CHECKOUT_SESSION_KEY]: SESSION_ID },
    items: [{ price: { id: PRICE_IDS.get("standard_yearly") } }],
    current_billing_period: { starts_at: "2026-09-25T10:00:00Z", ends_at: "2027-09-25T10:00:00Z" },
    scheduled_change: null,
    updated_at: "2026-09-25T10:00:01.123456Z",
    ...overrides,
  };
}

function event(eventType: string, data: unknown) {
  return { event_id: "evt_1", event_type: eventType, occurred_at: "2026-09-25T10:00:02.5Z", notification_id: "ntf_1", data };
}

const CHECKOUT_INPUT: CreateCheckoutInput = {
  checkoutSessionId: SESSION_ID,
  userId: "user-1",
  email: "a@example.com",
  name: null,
  mode: "subscription",
  interval: "year",
  productCode: "pro_yearly",
  credits: 174000,
  amountAgorot: 432000,
  currency: "ILS",
  successUrl: "https://app.example/app/settings?checkout=success",
  failureUrl: "https://app.example/app/settings?checkout=failed",
  expiresAt: NOW,
};

test("config requires every plan's price and a known environment", () => {
  const env = {
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_API_KEY: "k",
    PADDLE_WEBHOOK_SECRET: "s",
    PADDLE_TOPUP_PRODUCT_ID: "pro_1",
    PADDLE_CLIENT_TOKEN: "test_1",
    NEXT_PUBLIC_APP_URL: "https://app.example/",
    PADDLE_PRICE_IDS: JSON.stringify(Object.fromEntries(PRICE_IDS)),
  };
  const config = readPaddleConfig(env);
  assert.equal(config.priceIds.get("pro_yearly"), PRICE_IDS.get("pro_yearly"));
  assert.equal(config.appUrl, "https://app.example");
  assert.throws(() => readPaddleConfig({ ...env, PADDLE_ENVIRONMENT: "live" }), BillingUnavailableError);
  assert.throws(() => readPaddleConfig({ ...env, PADDLE_PRICE_IDS: JSON.stringify({ basic: "pri_1" }) }), /missing: standard/);
  assert.throws(() => readPaddleConfig({ ...env, PADDLE_PRICE_IDS: "{" }), BillingUnavailableError);
  assert.throws(() => readPaddleConfig({ ...env, PADDLE_CLIENT_TOKEN: "" }), /PADDLE_CLIENT_TOKEN/);
});

test("a subscription checkout creates a transaction for the plan's catalogue price, tagged with our session", async () => {
  const { adapter, calls } = provider([{ status: 201, body: { data: transaction({ id: "txn_new", status: "ready" }) } }]);
  const result = await adapter.createCheckout(CHECKOUT_INPUT);
  assert.deepEqual(result, { url: `https://app.example${PADDLE_PAY_PATH}?session=${SESSION_ID}`, providerCheckoutId: "txn_new" });
  const call = calls[0]!;
  assert.deepEqual([call.method, call.url], ["POST", "https://sandbox-api.paddle.com/transactions"]);
  assert.equal(call.headers.Authorization, `Bearer ${CONFIG.apiKey}`);
  assert.deepEqual(call.body, {
    items: [{ price_id: PRICE_IDS.get("pro_yearly"), quantity: 1 }],
    currency_code: "ILS",
    custom_data: { [CHECKOUT_SESSION_KEY]: SESSION_ID },
  });
});

test("a top-up checkout prices the exact amount, VAT included, named for the buyer and pinned to one unit", async () => {
  const { adapter, calls } = provider([{ status: 201, body: { data: transaction({ subscription_id: null }) } }]);
  await adapter.createCheckout({ ...CHECKOUT_INPUT, mode: "one_time", interval: null, productCode: "topup_ils_50", credits: 2000, amountAgorot: 5000 });
  assert.deepEqual((calls[0]!.body as { items: unknown[] }).items, [
    {
      quantity: 1,
      price: {
        name: "2,000 credits",
        description: "topup_ils_50",
        product_id: "pro_topup",
        unit_price: { amount: "5000", currency_code: "ILS" },
        tax_mode: "internal",
        quantity: { minimum: 1, maximum: 1 },
      },
    },
  ]);
});

test("creating a transaction is never retried; an API error surfaces with its code", async () => {
  const { adapter, calls } = provider([{ status: 503, body: { error: { code: "service_unavailable" } } }]);
  await assert.rejects(adapter.createCheckout(CHECKOUT_INPUT), (err: unknown) => {
    assert.ok(err instanceof PaymentProviderError);
    assert.equal(err.retryable, true);
    assert.match(err.message, /POST \/transactions: service_unavailable/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("webhook signatures: valid, rotated, tampered, stale, missing", async () => {
  const body = event("transaction.created", transaction());
  const { adapter } = provider();
  assert.equal((await adapter.parseWebhook(signed(body))).kind, "ignored");

  const rawBody = JSON.stringify(body);
  const ts = Math.floor(NOW.getTime() / 1000);
  const rotated = `ts=${ts};h1=${signBody("old-secret", `${ts}:${rawBody}`)};h1=${signBody(SECRET, `${ts}:${rawBody}`)}`;
  assert.equal((await adapter.parseWebhook({ rawBody, header: () => rotated })).kind, "ignored");

  const good = signed(body);
  await assert.rejects(adapter.parseWebhook({ ...good, rawBody: good.rawBody + " " }), WebhookVerificationError);
  await assert.rejects(adapter.parseWebhook(signed(body, new Date(NOW.getTime() - 10 * 60 * 1000))), WebhookVerificationError);
  await assert.rejects(adapter.parseWebhook(signed(body, NOW, "wrong")), WebhookVerificationError);
  await assert.rejects(adapter.parseWebhook({ rawBody: good.rawBody, header: () => null }), WebhookVerificationError);
  await assert.rejects(adapter.parseWebhook({ rawBody: good.rawBody, header: () => "h1=abc" }), WebhookVerificationError);
});

test("the checkout charge becomes a payment tied to our session, with Paddle's period end", async () => {
  const { adapter } = provider();
  const parsed = await adapter.parseWebhook(signed(event("transaction.completed", transaction())));
  assert.equal(parsed.kind, "payment.succeeded");
  if (parsed.kind !== "payment.succeeded") return;
  assert.deepEqual(
    {
      id: parsed.providerEventId,
      sub: parsed.providerSubscriptionId,
      plan: parsed.planCode,
      payment: parsed.payment,
      end: parsed.periodEnd?.toISOString(),
      session: parsed.reference.checkoutSessionId,
    },
    {
      id: "evt_1",
      sub: "sub_1",
      plan: "standard",
      payment: { providerPaymentId: "txn_1", amountAgorot: 20000, currency: "ILS" },
      end: "2026-10-25T10:00:00.000Z",
      session: SESSION_ID,
    },
  );
});

test("a paid top-up is a one-time charge tied to its session", async () => {
  const { adapter } = provider();
  const parsed = await adapter.parseWebhook(
    signed(event("transaction.completed", transaction({ subscription_id: null, items: [{ price: { id: "pri_adhoc", custom_data: null } }], details: { totals: { total: "5000", grand_total: "0" } } }))),
  );
  assert.equal(parsed.kind, "payment.succeeded");
  if (parsed.kind !== "payment.succeeded") return;
  assert.deepEqual(
    { sub: parsed.providerSubscriptionId, plan: parsed.planCode, amount: parsed.payment.amountAgorot, session: parsed.reference.checkoutSessionId },
    { sub: null, plan: null, amount: 5000, session: SESSION_ID },
  );
});

test("a browser-built checkout is ignored: its custom_data is written by the client", async () => {
  const { adapter } = provider();
  assert.equal((await adapter.parseWebhook(signed(event("transaction.completed", transaction({ origin: "web" }))))).kind, "ignored");
});

test("renewals resolve through the subscription, not the copied session; payment-method changes bill nothing", async () => {
  const { adapter } = provider();
  const renewal = await adapter.parseWebhook(signed(event("transaction.completed", transaction({ origin: "subscription_recurring" }))));
  assert.equal(renewal.kind === "payment.succeeded" && renewal.reference.checkoutSessionId, null);
  const methodChange = await adapter.parseWebhook(
    signed(event("transaction.completed", transaction({ origin: "subscription_payment_method_change", details: { totals: { total: "0" } } }))),
  );
  assert.equal(methodChange.kind, "ignored");
  const failed = await adapter.parseWebhook(signed(event("transaction.payment_failed", transaction())));
  assert.equal(failed.kind, "ignored");
});

test("subscription events become snapshots; a scheduled cancel keeps access to the period end", async () => {
  const { adapter } = provider();
  const parsed = await adapter.parseWebhook(
    signed(event("subscription.updated", subscriptionData({ scheduled_change: { action: "cancel", effective_at: "2027-09-25T10:00:00Z" } }))),
  );
  assert.equal(parsed.kind, "subscription.snapshot");
  if (parsed.kind !== "subscription.snapshot") return;
  assert.deepEqual(
    { ...parsed.subscription, currentPeriodEnd: parsed.subscription.currentPeriodEnd?.toISOString(), providerUpdatedAt: parsed.subscription.providerUpdatedAt.toISOString() },
    {
      providerSubscriptionId: "sub_1",
      providerCustomerId: "ctm_1",
      planCode: "standard_yearly",
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2027-09-25T10:00:00.000Z",
      trialEndsAt: null,
      providerUpdatedAt: "2026-09-25T10:00:01.123Z",
    },
  );
  assert.equal(parsed.reference.checkoutSessionId, SESSION_ID);
});

test("a retired price still resolves through its plan tag; an untagged unknown price is rejected", async () => {
  const { adapter } = provider();
  const retired = await adapter.parseWebhook(
    signed(event("subscription.updated", subscriptionData({ items: [{ price: { id: "pri_retired", custom_data: { [PRICE_PLAN_KEY]: "pro" } } }] }))),
  );
  assert.equal(retired.kind === "subscription.snapshot" && retired.subscription.planCode, "pro");
  await assert.rejects(
    adapter.parseWebhook(signed(event("subscription.created", subscriptionData({ items: [{ price: { id: "pri_other" } }] })))),
    MalformedWebhookError,
  );
  await assert.rejects(adapter.parseWebhook(signed(event("subscription.created", { id: "sub_1" }))), MalformedWebhookError);
  const raw = "not json";
  const ts = Math.floor(NOW.getTime() / 1000);
  await assert.rejects(
    adapter.parseWebhook({ rawBody: raw, header: () => `ts=${ts};h1=${signBody(SECRET, `${ts}:${raw}`)}` }),
    MalformedWebhookError,
  );
});

test("past due: paid access ends where the unpaid period starts", async () => {
  const { adapter } = provider();
  const parsed = await adapter.parseWebhook(
    signed(event("subscription.past_due", subscriptionData({ status: "past_due", current_billing_period: { starts_at: "2027-09-25T10:00:00Z", ends_at: "2028-09-25T10:00:00Z" } }))),
  );
  assert.equal(parsed.kind === "subscription.snapshot" && parsed.subscription.currentPeriodEnd?.toISOString(), "2027-09-25T10:00:00.000Z");
});

test("approved full refunds, chargebacks and chargeback warnings become refunds; pending, partial-as-flag and credits are told apart", async () => {
  const { adapter } = provider();
  const adjustment = (overrides: Record<string, unknown>) => ({ id: "adj_1", action: "refund", status: "approved", type: "full", transaction_id: "txn_1", subscription_id: "sub_1", ...overrides });
  const refund = await adapter.parseWebhook(signed(event("adjustment.updated", adjustment({}))));
  assert.deepEqual(
    refund.kind === "payment.refunded" && { id: refund.providerPaymentId, full: refund.full },
    { id: "txn_1", full: true },
  );
  for (const action of ["chargeback", "chargeback_warning"]) {
    assert.equal((await adapter.parseWebhook(signed(event("adjustment.created", adjustment({ action }))))).kind, "payment.refunded");
  }
  assert.equal((await adapter.parseWebhook(signed(event("adjustment.created", adjustment({ action: "chargeback_reverse" }))))).kind, "ignored");
  const partial = await adapter.parseWebhook(signed(event("adjustment.updated", adjustment({ type: "partial" }))));
  assert.equal(partial.kind === "payment.refunded" && partial.full, false);
  assert.equal((await adapter.parseWebhook(signed(event("adjustment.created", adjustment({ status: "pending_approval" }))))).kind, "ignored");
  assert.equal((await adapter.parseWebhook(signed(event("adjustment.created", adjustment({ action: "credit" }))))).kind, "ignored");
});

test("a past-due subscription cannot be cancelled until the overdue charge is paid", async () => {
  const { adapter, calls } = provider([{ status: 200, body: { data: subscriptionData({ status: "past_due" }) } }]);
  await assert.rejects(adapter.cancelSubscription("sub_1"), PaymentOverdueError);
  assert.equal(calls.length, 1);
});

test("cancel schedules the end of the period, resume clears it, both return Paddle's state", async () => {
  const { adapter, calls } = provider([
    { status: 200, body: { data: subscriptionData() } },
    { status: 200, body: { data: subscriptionData({ scheduled_change: { action: "cancel", effective_at: "2027-09-25T10:00:00Z" } }) } },
    { status: 200, body: { data: subscriptionData() } },
  ]);
  assert.equal((await adapter.cancelSubscription("sub_1")).cancelAtPeriodEnd, true);
  assert.equal((await adapter.resumeSubscription("sub_1")).cancelAtPeriodEnd, false);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ["GET", "https://sandbox-api.paddle.com/subscriptions/sub_1", undefined],
      ["POST", "https://sandbox-api.paddle.com/subscriptions/sub_1/cancel", { effective_from: "next_billing_period" }],
      ["PATCH", "https://sandbox-api.paddle.com/subscriptions/sub_1", { scheduled_change: null }],
    ],
  );
});

test("portal and payment-method links come from Paddle", async () => {
  const { adapter, calls } = provider([
    { status: 200, body: { data: subscriptionData() } },
    { status: 201, body: { data: { urls: { general: { overview: "https://customer-portal.paddle.com/cpl_1" } } } } },
    { status: 200, body: { data: transaction({ checkout: { url: "https://app.example/pay?_ptxn=txn_9" } }) } },
  ]);
  assert.equal(await adapter.getCustomerPortalUrl("sub_1"), "https://customer-portal.paddle.com/cpl_1");
  assert.equal(await adapter.getUpdatePaymentMethodUrl("sub_1", "unused"), "https://app.example/pay?_ptxn=txn_9");
  assert.deepEqual(calls[1]!.body, { subscription_ids: ["sub_1"] });
  assert.equal(calls[2]!.url, "https://sandbox-api.paddle.com/subscriptions/sub_1/update-payment-method-transaction");
});

const UPGRADE_LINES = [
  { price_id: PRICE_IDS.get("pro"), quantity: 1, proration: { rate: "0.5" } },
  { price_id: PRICE_IDS.get("standard"), quantity: -1, proration: { rate: "0.5" } },
];

test("a plan change charge becomes a proration with its lines; a full new period counts as rate 1", async () => {
  const { adapter } = provider();
  const upgrade = await adapter.parseWebhook(
    signed(event("transaction.completed", transaction({ origin: "subscription_update", custom_data: null, details: { totals: { total: "10000" }, line_items: UPGRADE_LINES } }))),
  );
  assert.deepEqual(upgrade.kind === "subscription.prorated" && { ...upgrade, payload: undefined, eventType: undefined, providerEventId: undefined, occurredAt: undefined }, {
    kind: "subscription.prorated",
    payload: undefined,
    eventType: undefined,
    providerEventId: undefined,
    occurredAt: undefined,
    reference: { checkoutSessionId: null },
    providerSubscriptionId: "sub_1",
    payment: { providerPaymentId: "txn_1", amountAgorot: 10000, currency: "ILS" },
    lines: [
      { planCode: "pro", quantity: 1, rate: 0.5 },
      { planCode: "standard", quantity: -1, rate: 0.5 },
    ],
    periodEnd: new Date("2026-10-25T10:00:00.000Z"),
  });
  const toYearly = await adapter.parseWebhook(
    signed(
      event(
        "transaction.completed",
        transaction({ origin: "subscription_update", details: { totals: { total: "98003" }, line_items: [{ price_id: PRICE_IDS.get("standard_yearly"), quantity: 1, proration: null }] } }),
      ),
    ),
  );
  assert.deepEqual(toYearly.kind === "subscription.prorated" && toYearly.lines, [{ planCode: "standard_yearly", quantity: 1, rate: 1 }]);
});

test("a retired price resolves through Paddle's own plan tag; a price outside our plans is rejected", async () => {
  const retired = { price_id: "pri_retired", quantity: -1, proration: { rate: "0.5" } };
  const { adapter, calls } = provider([
    { status: 200, body: { data: { id: "pri_retired", custom_data: { [PRICE_PLAN_KEY]: "standard" } } } },
    { status: 200, body: { data: { id: "pri_retired", custom_data: null } } },
  ]);
  const charge = (lines: unknown[]) =>
    signed(event("transaction.completed", transaction({ origin: "subscription_update", details: { totals: { total: "10000" }, line_items: lines } })));
  const resolved = await adapter.parseWebhook(charge([UPGRADE_LINES[0], retired]));
  assert.deepEqual(resolved.kind === "subscription.prorated" && resolved.lines[1], { planCode: "standard", quantity: -1, rate: 0.5 });
  await assert.rejects(adapter.parseWebhook(charge([retired])), MalformedWebhookError);
  assert.equal(calls[0]!.url, "https://sandbox-api.paddle.com/prices/pri_retired");
});

test("a failed price lookup is retried by redelivery; a plan change charge without its subscription is malformed", async () => {
  const { adapter } = provider([{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }]);
  const retired = [{ price_id: "pri_retired", quantity: -1, proration: { rate: "0.5" } }];
  await assert.rejects(
    adapter.parseWebhook(signed(event("transaction.completed", transaction({ origin: "subscription_update", details: { totals: { total: "10000" }, line_items: retired } })))),
    (err: unknown) => err instanceof PaymentProviderError && err.retryable,
  );
  await assert.rejects(
    adapter.parseWebhook(signed(event("transaction.completed", transaction({ origin: "subscription_update", subscription_id: null, details: { totals: { total: "1" }, line_items: [] } })))),
    MalformedWebhookError,
  );
});

test("a plan change charges the saved card only through prorated_immediately and refuses on decline; a downgrade bills nothing", async () => {
  const { adapter, calls } = provider([
    { status: 200, body: { data: subscriptionData({ items: [{ price: { id: PRICE_IDS.get("pro") } }] }) } },
    { status: 200, body: { data: subscriptionData({ items: [{ price: { id: PRICE_IDS.get("basic") } }] }) } },
  ]);
  assert.equal((await adapter.changePlan("sub_1", "pro", "prorate_now")).planCode, "pro");
  assert.equal((await adapter.changePlan("sub_1", "basic", "at_renewal")).planCode, "basic");
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      [
        "PATCH",
        "https://sandbox-api.paddle.com/subscriptions/sub_1",
        { items: [{ price_id: PRICE_IDS.get("pro"), quantity: 1 }], proration_billing_mode: "prorated_immediately", on_payment_failure: "prevent_change" },
      ],
      [
        "PATCH",
        "https://sandbox-api.paddle.com/subscriptions/sub_1",
        { items: [{ price_id: PRICE_IDS.get("basic"), quantity: 1 }], proration_billing_mode: "do_not_bill", on_payment_failure: "prevent_change" },
      ],
    ],
  );
});

test("Paddle's plan change refusals map to billing errors; a charging request is never retried", async () => {
  const refusal = (code: string, status = 400) => ({ status, body: { error: { code } } });
  const { adapter, calls } = provider([
    refusal("subscription_payment_declined"),
    refusal("subscription_locked_renewal", 409),
    refusal("subscription_update_transaction_balance_less_than_charge_limit"),
    refusal("subscription_update_when_past_due"),
    refusal("subscription_payment_provider_unavailable", 500),
  ]);
  await assert.rejects(adapter.changePlan("sub_1", "pro", "prorate_now"), PaymentDeclinedError);
  await assert.rejects(adapter.changePlan("sub_1", "pro", "prorate_now"), RenewalImminentError);
  await assert.rejects(adapter.changePlan("sub_1", "pro", "prorate_now"), RenewalImminentError);
  await assert.rejects(adapter.changePlan("sub_1", "pro", "prorate_now"), PaymentOverdueError);
  await assert.rejects(adapter.changePlan("sub_1", "pro", "prorate_now"), PaymentProviderError);
  assert.equal(calls.length, 5);
});

test("the preview reports the charge after Paddle credit, the prorated lines and the next renewal", async () => {
  const { adapter, calls } = provider([
    {
      status: 200,
      body: {
        data: {
          next_billed_at: "2026-10-25T10:00:00Z",
          immediate_transaction: { details: { totals: { grand_total: "9997" }, line_items: UPGRADE_LINES } },
          next_transaction: { details: { totals: { total: "40000" } } },
          update_summary: { credit: { amount: "-9997" } },
        },
      },
    },
    { status: 200, body: { data: { next_billed_at: "2026-10-25T10:00:00Z", immediate_transaction: null, next_transaction: { details: { totals: { total: "10000" } } } } } },
  ]);
  assert.deepEqual(await adapter.previewPlanChange("sub_1", "pro", "prorate_now"), {
    chargeNowAgorot: 9997,
    creditAgorot: 9997,
    lines: [
      { planCode: "pro", quantity: 1, rate: 0.5 },
      { planCode: "standard", quantity: -1, rate: 0.5 },
    ],
    nextChargeAgorot: 40000,
    nextChargeAt: new Date("2026-10-25T10:00:00Z"),
  });
  assert.deepEqual(await adapter.previewPlanChange("sub_1", "basic", "at_renewal"), {
    chargeNowAgorot: null,
    creditAgorot: 0,
    lines: [],
    nextChargeAgorot: 10000,
    nextChargeAt: new Date("2026-10-25T10:00:00Z"),
  });
  assert.equal(calls[0]!.url, "https://sandbox-api.paddle.com/subscriptions/sub_1/preview");
});

// Captured from the sandbox (2026-09-25): an upgrade credits the billed plan; after a `do_not_bill` downgrade there is no credit line.
const REAL_PLAN_CHANGES = [
  {
    id: "txn_01m3ctmrttjp8q9jhqv57jpe6k",
    items: [
      { price: { id: "pri_01m3c3f80xe5w7kcfjefram02b", custom_data: { [PRICE_PLAN_KEY]: "standard" } } },
      { price: { id: "pri_01m3c3f7cjjjf5zxnksdndnwjh", custom_data: { [PRICE_PLAN_KEY]: "basic" } } },
    ],
    details: {
      totals: { total: "9963" },
      line_items: [
        { price_id: "pri_01m3c3f80xe5w7kcfjefram02b", quantity: 1, proration: { rate: "0.99623" } },
        { price_id: "pri_01m3c3f7cjjjf5zxnksdndnwjh", quantity: -1, proration: { rate: "0.99623" } },
      ],
    },
  },
  {
    id: "txn_01m3d064tg9de0jzgjfrwn4e7z",
    items: [{ price: { id: "pri_01m3c3f8mq82bwzq0r43red0nk", custom_data: { [PRICE_PLAN_KEY]: "pro" } } }],
    details: { totals: { total: "39759" }, line_items: [{ price_id: "pri_01m3c3f8mq82bwzq0r43red0nk", quantity: 1, proration: { rate: "0.99398" } }] },
  },
];

test("real sandbox plan change charges resolve through their price tags into the lines credits are granted from", async () => {
  const { adapter } = provider();
  const lines = [];
  for (const change of REAL_PLAN_CHANGES) {
    const parsed = await adapter.parseWebhook(signed(event("transaction.completed", transaction({ ...change, origin: "subscription_update", custom_data: null }))));
    lines.push(parsed.kind === "subscription.prorated" ? parsed.lines : null);
  }
  assert.deepEqual(lines, [
    [
      { planCode: "standard", quantity: 1, rate: 0.99623 },
      { planCode: "basic", quantity: -1, rate: 0.99623 },
    ],
    [{ planCode: "pro", quantity: 1, rate: 0.99398 }],
  ]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CheckoutAlreadySettledError,
  CheckoutSessionNotFoundError,
  MalformedWebhookError,
  UnknownProviderError,
  WebhookVerificationError,
} from "../../src/lib/billing/errors";
import { signBody, verifyBodySignature } from "../../src/lib/billing/provider/hmac";
import { MockPaymentProvider } from "../../src/lib/billing/providers/mock/adapter";
import { readMockProviderConfig } from "../../src/lib/billing/providers/mock/config";
import { MockCheckoutSimulator } from "../../src/lib/billing/providers/mock/simulator";
import { MOCK_SIGNATURE_HEADER } from "../../src/lib/billing/providers/mock/wire";
import type { ProviderRegistry } from "../../src/lib/billing/provider/registry";
import { BillingService } from "../../src/lib/billing/service";
import { NOW, USER, harness, last, silentLogger } from "./fakes";

const SECRET = "test-secret-at-least-16-chars";
const provider = new MockPaymentProvider({ webhookSecret: SECRET, appUrl: "https://app.example" });

test("hmac helpers: sign/verify round-trip, reject tampering, constant-length compare", () => {
  const body = JSON.stringify({ hello: "world" });
  const sig = signBody(SECRET, body);
  assert.equal(verifyBodySignature(SECRET, body, sig), true);
  assert.equal(verifyBodySignature(SECRET, body + " ", sig), false);
  assert.equal(verifyBodySignature("other-secret-16-chars", body, sig), false);
  assert.equal(verifyBodySignature(SECRET, body, null), false);
  assert.equal(verifyBodySignature(SECRET, body, "abcd"), false);
  assert.equal(verifyBodySignature(SECRET, body, "zz".repeat(32)), false);
});

test("createCheckout points at the local mock page with the session id", async () => {
  const result = await provider.createCheckout({
    checkoutSessionId: "11111111-1111-4111-8111-111111111111",
    userId: USER.id,
    email: USER.email,
    name: USER.name,
    mode: "subscription",
    productCode: "standard",
    description: "סטנדרט",
    amountAgorot: 20000,
    currency: "ILS",
    successUrl: "https://app.example/ok",
    failureUrl: "https://app.example/fail",
    expiresAt: NOW,
  });
  assert.equal(result.url, "https://app.example/app/billing/mock-checkout?session=11111111-1111-4111-8111-111111111111");
  assert.equal(result.providerCheckoutId, "mock_chk_11111111-1111-4111-8111-111111111111");
});

test("parseWebhook maps checkout.completed to payment.succeeded with correlation", async () => {
  const sessionId = randomUUID();
  const request = provider.signedWebhook({
    type: "checkout.completed",
    id: "evt_1",
    occurredAt: NOW.toISOString(),
    checkoutSessionId: sessionId,
    mode: "subscription",
    subscriptionId: "mock_sub_1",
    customerId: "mock_cus_1",
    productCode: "standard",
    payment: { id: "mock_pay_1", amountAgorot: 20000, currency: "ILS" },
  });
  const event = await provider.parseWebhook(request);
  assert.equal(event.kind, "payment.succeeded");
  if (event.kind !== "payment.succeeded") return;
  assert.equal(event.providerEventId, "evt_1");
  assert.equal(event.providerSubscriptionId, "mock_sub_1");
  assert.equal(event.providerCustomerId, "mock_cus_1");
  assert.equal(event.planCode, "standard");
  assert.equal(event.occurredAt.getTime(), NOW.getTime());
  assert.deepEqual(event.payment, { providerPaymentId: "mock_pay_1", amountAgorot: 20000, currency: "ILS" });
  assert.deepEqual(event.reference, { checkoutSessionId: sessionId });
});

test("parseWebhook maps a one-time checkout to a payment with no subscription", async () => {
  const event = await provider.parseWebhook(
    provider.signedWebhook({
      type: "checkout.completed",
      id: "evt_topup",
      occurredAt: NOW.toISOString(),
      checkoutSessionId: randomUUID(),
      mode: "one_time",
      subscriptionId: null,
      customerId: "mock_cus_1",
      productCode: "topup_ils_50",
      payment: { id: "mock_pay_t", amountAgorot: 4900, currency: "ILS" },
    }),
  );
  assert.equal(event.kind, "payment.succeeded");
  if (event.kind !== "payment.succeeded") return;
  assert.equal(event.providerSubscriptionId, null);
  assert.equal(event.planCode, null);
});

test("parseWebhook maps the remaining mock event types", async () => {
  const sessionId = randomUUID();
  const failed = await provider.parseWebhook(
    provider.signedWebhook({
      type: "checkout.failed",
      id: "evt_2",
      occurredAt: NOW.toISOString(),
      checkoutSessionId: sessionId,
      reason: "card_declined",
    }),
  );
  assert.equal(failed.kind, "checkout.failed");

  const renewal = await provider.parseWebhook(
    provider.signedWebhook({
      type: "payment.succeeded",
      id: "evt_3",
      occurredAt: NOW.toISOString(),
      subscriptionId: "mock_sub_1",
      payment: { id: "mock_pay_2", amountAgorot: 19900, currency: "ILS" },
    }),
  );
  assert.equal(renewal.kind, "payment.succeeded");
  if (renewal.kind === "payment.succeeded") assert.equal(renewal.planCode, null);

  const declined = await provider.parseWebhook(
    provider.signedWebhook({
      type: "payment.failed",
      id: "evt_4",
      occurredAt: NOW.toISOString(),
      subscriptionId: "mock_sub_1",
      payment: null,
      reason: "insufficient_funds",
    }),
  );
  assert.equal(declined.kind, "payment.failed");

  const canceled = await provider.parseWebhook(
    provider.signedWebhook({
      type: "subscription.canceled",
      id: "evt_5",
      occurredAt: NOW.toISOString(),
      subscriptionId: "mock_sub_1",
      accessEndsAt: "2026-09-30T00:00:00.000Z",
    }),
  );
  assert.equal(canceled.kind, "subscription.canceled");
  if (canceled.kind === "subscription.canceled") {
    assert.equal(canceled.accessEndsAt?.toISOString(), "2026-09-30T00:00:00.000Z");
  }
});

test("parseWebhook rejects bad signatures, non-JSON, and unknown shapes", async () => {
  const signed = provider.signedWebhook({
    type: "subscription.canceled",
    id: "evt_6",
    occurredAt: NOW.toISOString(),
    subscriptionId: "mock_sub_1",
    accessEndsAt: null,
  });

  await assert.rejects(provider.parseWebhook({ rawBody: signed.rawBody, header: () => null }), WebhookVerificationError);
  await assert.rejects(
    provider.parseWebhook({ rawBody: signed.rawBody + " ", header: signed.header }),
    WebhookVerificationError,
  );

  const notJson = "not json";
  await assert.rejects(
    provider.parseWebhook({ rawBody: notJson, header: () => signBody(SECRET, notJson) }),
    MalformedWebhookError,
  );

  const unknown = JSON.stringify({ type: "refund.created", id: "x", occurredAt: NOW.toISOString() });
  await assert.rejects(
    provider.parseWebhook({ rawBody: unknown, header: () => signBody(SECRET, unknown) }),
    MalformedWebhookError,
  );
});

test("signedWebhook exposes the signature only under its header name", () => {
  const request = provider.signedWebhook({
    type: "subscription.canceled",
    id: "evt_7",
    occurredAt: NOW.toISOString(),
    subscriptionId: "mock_sub_1",
    accessEndsAt: null,
  });
  assert.equal(request.header(MOCK_SIGNATURE_HEADER), signBody(SECRET, request.rawBody));
  assert.equal(request.header(MOCK_SIGNATURE_HEADER.toUpperCase()), signBody(SECRET, request.rawBody));
  assert.equal(request.header("authorization"), null);
});

test("readMockProviderConfig refuses production and weak secrets", () => {
  assert.throws(() => readMockProviderConfig({ NODE_ENV: "production", MOCK_PAYMENT_WEBHOOK_SECRET: SECRET }), /production/);
  assert.throws(() => readMockProviderConfig({ NEXT_PUBLIC_APP_URL: "https://app.example" }), /MOCK_PAYMENT_WEBHOOK_SECRET/);
  assert.throws(
    () => readMockProviderConfig({ NEXT_PUBLIC_APP_URL: "https://app.example", MOCK_PAYMENT_WEBHOOK_SECRET: "short" }),
    /at least 16/,
  );
  assert.deepEqual(
    readMockProviderConfig({ NEXT_PUBLIC_APP_URL: "https://app.example/", MOCK_PAYMENT_WEBHOOK_SECRET: SECRET }),
    { webhookSecret: SECRET, appUrl: "https://app.example" },
  );
});

test("simulator drives a full mock checkout through the real webhook path", async () => {
  const h = harness();
  const registry: ProviderRegistry = { active: provider, byName: (name) => (name === "mock" ? provider : null) };
  const service = new BillingService({
    providers: registry,
    subscriptions: h.subscriptions,
    checkouts: h.checkouts,
    payments: h.payments,
    events: h.events,
    trialClaims: h.trialClaims,
    credits: h.credits,
    enforcement: true,
    appUrl: "https://app.example",
    now: () => NOW,
    logger: silentLogger,
  });
  const simulator = new MockCheckoutSimulator(service, () => NOW);

  await service.startCheckout(USER, "standard");
  const session = last(h.checkouts.rows);

  await assert.rejects(simulator.complete({ ...USER, id: "intruder" }, session.id, "success"), CheckoutSessionNotFoundError);

  assert.equal(await simulator.complete(USER, session.id, "success"), "processed");
  assert.equal(session.status, "completed");
  assert.equal((await service.getStatus(USER)).entitled, true);
  assert.equal(h.payments.rows[0]?.amountAgorot, 20000);
  assert.equal(h.grants.rows.find((g) => g.kind === "plan")?.credits, 2500);

  await assert.rejects(simulator.complete(USER, session.id, "failure"), CheckoutAlreadySettledError);
});

test("simulator refuses when the active provider is not the mock", async () => {
  const h = harness();
  const simulator = new MockCheckoutSimulator(h.service, () => NOW);
  await assert.rejects(simulator.complete(USER, randomUUID(), "success"), UnknownProviderError);
});

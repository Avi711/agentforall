import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChangePlanBodySchema,
  CheckoutBodySchema,
  MockCheckoutCompleteBodySchema,
  TopupBodySchema,
  WebhookProviderParamsSchema,
} from "../../src/lib/billing/schemas";
import { DEFAULT_PLAN, TOPUP_MAX_ILS, TOPUP_MIN_ILS } from "../../src/lib/billing/pricing";

test("checkout body requires a plan and rejects unknown keys or plans", () => {
  assert.equal(CheckoutBodySchema.safeParse({}).success, false);
  assert.deepEqual(CheckoutBodySchema.parse({ plan: DEFAULT_PLAN }), { plan: DEFAULT_PLAN });
  assert.equal(CheckoutBodySchema.safeParse({ plan: "gold" }).success, false);
  assert.equal(CheckoutBodySchema.safeParse({ plan: "pro", extra: 1 }).success, false);
  assert.equal(ChangePlanBodySchema.safeParse({}).success, false);
});

test("top-up body enforces whole shekels inside the range", () => {
  assert.equal(TopupBodySchema.safeParse({ amountIls: TOPUP_MIN_ILS }).success, true);
  assert.equal(TopupBodySchema.safeParse({ amountIls: TOPUP_MAX_ILS }).success, true);
  assert.equal(TopupBodySchema.safeParse({ amountIls: TOPUP_MIN_ILS - 1 }).success, false);
  assert.equal(TopupBodySchema.safeParse({ amountIls: 50.5 }).success, false);
  assert.equal(TopupBodySchema.safeParse({ amountIls: "50" }).success, false);
});

test("webhook provider param is a short slug", () => {
  assert.equal(WebhookProviderParamsSchema.safeParse({ provider: "mock" }).success, true);
  assert.equal(WebhookProviderParamsSchema.safeParse({ provider: "Pay Plus" }).success, false);
  assert.equal(WebhookProviderParamsSchema.safeParse({ provider: "a".repeat(33) }).success, false);
});

test("mock completion body requires a uuid session and a known outcome", () => {
  assert.equal(MockCheckoutCompleteBodySchema.safeParse({ sessionId: "nope", outcome: "success" }).success, false);
  assert.equal(
    MockCheckoutCompleteBodySchema.safeParse({ sessionId: "11111111-1111-4111-8111-111111111111", outcome: "maybe" }).success,
    false,
  );
});

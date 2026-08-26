import { test } from "node:test";
import assert from "node:assert/strict";
import { BillingUnavailableError } from "../../src/lib/billing/errors";
import { createProviderRegistry, resolveActiveProviderName } from "../../src/lib/billing/provider/registry";
import { DisabledPaymentProvider } from "../../src/lib/billing/providers/disabled";
import { MockPaymentProvider } from "../../src/lib/billing/providers/mock/adapter";

const noLog = { info() {}, warn() {}, error() {} };
const APP = { NEXT_PUBLIC_APP_URL: "https://app.example" };

test("resolveActiveProviderName requires a known PAYMENT_PROVIDER", () => {
  assert.throws(() => resolveActiveProviderName({}), BillingUnavailableError);
  assert.throws(() => resolveActiveProviderName({ PAYMENT_PROVIDER: "stripe" }), /unknown PAYMENT_PROVIDER/);
  assert.equal(resolveActiveProviderName({ PAYMENT_PROVIDER: " mock " }), "mock");
});

test("no PAYMENT_PROVIDER yields a disabled registry that still answers byName safely", () => {
  const logs: Array<{ message: string; meta: Record<string, unknown> | undefined }> = [];
  const registry = createProviderRegistry({}, {}, { ...noLog, warn: (message, meta) => logs.push({ message, meta }) });
  assert.ok(registry.active instanceof DisabledPaymentProvider);
  assert.equal(registry.active.available, false);
  assert.equal(registry.byName("mock"), null);
  assert.equal(logs[0]?.message, "billing disabled");
  assert.match(String(logs[0]?.meta?.reason), /PAYMENT_PROVIDER/);
});

test("active provider missing credentials degrades to disabled with the reason", async () => {
  const registry = createProviderRegistry({ PAYMENT_PROVIDER: "mock", ...APP }, {}, noLog);
  assert.ok(registry.active instanceof DisabledPaymentProvider);
  assert.match(registry.active.reason, /MOCK_PAYMENT_WEBHOOK_SECRET/);
  assert.equal(registry.byName("mock"), null);
  await assert.rejects(registry.active.getCustomerPortalUrl("x"), BillingUnavailableError);
});

test("configured mock provider is live and addressable by name", () => {
  const registry = createProviderRegistry(
    { PAYMENT_PROVIDER: "mock", MOCK_PAYMENT_WEBHOOK_SECRET: "test-secret-at-least-16-chars", ...APP },
    {},
    noLog,
  );
  assert.ok(registry.active instanceof MockPaymentProvider);
  assert.equal(registry.byName("mock"), registry.active);
  assert.equal(registry.byName("stripe"), null);
});

test("mock provider is refused in production even when configured", () => {
  const registry = createProviderRegistry(
    { NODE_ENV: "production", PAYMENT_PROVIDER: "mock", MOCK_PAYMENT_WEBHOOK_SECRET: "test-secret-at-least-16-chars", ...APP },
    {},
    noLog,
  );
  assert.ok(registry.active instanceof DisabledPaymentProvider);
  assert.match(registry.active.reason, /production/);
});

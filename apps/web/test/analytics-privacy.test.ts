import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaptureResult } from "posthog-js";
import { scrubEvent, scrubUrl } from "../src/lib/analytics/privacy";

function pageview(properties: CaptureResult["properties"], extra: Partial<CaptureResult> = {}): CaptureResult {
  return { uuid: "1", event: "$pageview", properties, ...extra };
}

test("secrets in the query string are dropped, campaign and page-state params stay", () => {
  assert.equal(scrubUrl("https://agentforall.co.il/verify-email?token=abc&callbackURL=%2Fapp"), "https://agentforall.co.il/verify-email");
  assert.equal(scrubUrl("https://agentforall.co.il/pay?_ptxn=txn_01h"), "https://agentforall.co.il/pay");
  assert.equal(
    scrubUrl("https://agentforall.co.il/login?mode=signup&redirect=%2Fpay%3Fsession%3Dx&utm_source=ig"),
    "https://agentforall.co.il/login?mode=signup&utm_source=ig",
  );
});

test("relative links are scrubbed and stay relative", () => {
  assert.equal(scrubUrl("/pay?session=5f1c"), "/pay");
  assert.equal(scrubUrl("/login?mode=signup&token=x"), "/login?mode=signup");
});

test("a URL that cannot be parsed loses its query instead of passing through", () => {
  assert.equal(scrubUrl("https://[bad/verify-email?token=abc"), "https://[bad/verify-email");
});

test("values without a query or that are not URLs pass through untouched", () => {
  for (const value of ["https://agentforall.co.il/app", "/app/settings", "$direct", "not a url"]) {
    assert.equal(scrubUrl(value), value);
  }
});

test("URL values are scrubbed in nested objects, arrays and person properties", () => {
  const scrubbed = scrubEvent(
    pageview(
      {
        $pathname: "/app",
        $referrer: "https://agentforall.co.il/pay?session=5f1c",
        $set_once: { $initial_referrer: "https://agentforall.co.il/pay?_ptxn=txn_01h" },
        $elements: [{ tag_name: "a", attr__href: "/app/billing/return?session=5f1c" }],
        count: 3,
      },
      { $set_once: { $initial_current_url: "https://agentforall.co.il/app/billing/return?session=5f1c" } },
    ),
  );

  assert.equal(scrubbed?.properties.$referrer, "https://agentforall.co.il/pay");
  assert.equal(scrubbed?.properties.$set_once.$initial_referrer, "https://agentforall.co.il/pay");
  assert.equal(scrubbed?.properties.$elements[0].attr__href, "/app/billing/return");
  assert.equal(scrubbed?.properties.count, 3);
  assert.equal(scrubbed?.$set_once?.$initial_current_url, "https://agentforall.co.il/app/billing/return");
});

test("nothing captured on admin screens leaves the browser", () => {
  assert.equal(scrubEvent(pageview({ $pathname: "/admin" })), null);
  assert.equal(scrubEvent(pageview({ $pathname: "/admin/users", $el_text: "someone@example.com" })), null);
  assert.notEqual(scrubEvent(pageview({ $pathname: "/administration-guide" })), null);
  assert.equal(scrubEvent(null), null);
});

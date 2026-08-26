import { test } from "node:test";
import assert from "node:assert/strict";
import { trialClaimKey } from "../../src/lib/billing/credits/trial-claim";

test("trialClaimKey folds case, whitespace, plus-tags, and Gmail dots into one key", () => {
  const base = trialClaimKey("dana@example.com");
  assert.equal(trialClaimKey("  Dana@Example.COM "), base);
  assert.equal(trialClaimKey("dana+promo@example.com"), base);
  assert.notEqual(trialClaimKey("da.na@example.com"), base);

  const gmail = trialClaimKey("dana@gmail.com");
  assert.equal(trialClaimKey("d.a.n.a+x@googlemail.com"), gmail);
  assert.notEqual(trialClaimKey("dana@example.com"), gmail);
  assert.match(base, /^[0-9a-f]{64}$/);
});

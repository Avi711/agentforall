import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronRequestAuthorized } from "../../src/lib/auth/cron";

const SECRET = "s3cret-value-with-entropy";

test("cron requests need the exact bearer secret; an unset secret refuses everything", () => {
  assert.equal(isCronRequestAuthorized(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isCronRequestAuthorized(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(isCronRequestAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
  assert.equal(isCronRequestAuthorized(SECRET, SECRET), false);
  assert.equal(isCronRequestAuthorized(null, SECRET), false);
  assert.equal(isCronRequestAuthorized(`Bearer ${SECRET}`, undefined), false);
  assert.equal(isCronRequestAuthorized(`Bearer ${SECRET}`, ""), false);
});

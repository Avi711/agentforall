import { test } from "node:test";
import assert from "node:assert/strict";
import { PhoneBodySchema } from "../src/routes/schemas.js";
import { isAuthorized } from "../src/auth.js";

test("sidecar phone validation matches the public pairing boundary", () => {
  assert.equal(PhoneBodySchema.safeParse({ phone: "+972527780673" }).success, true);
  assert.equal(PhoneBodySchema.safeParse({ phone: "972527780673" }).success, true);
  assert.equal(PhoneBodySchema.safeParse({ phone: "052-778-0673" }).success, false);
  assert.equal(PhoneBodySchema.safeParse({ phone: "" }).success, false);
});

test("sidecar bearer auth rejects non-ascii token length mismatches", () => {
  const expected = Buffer.from("a".repeat(64), "utf8");
  assert.equal(isAuthorized(`Bearer ${"a".repeat(64)}`, expected), true);
  assert.equal(isAuthorized(`Bearer ${"א".repeat(64)}`, expected), false);
});

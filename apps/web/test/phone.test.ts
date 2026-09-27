import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhoneForDisplay } from "../src/lib/phone";

test("Israeli numbers show in their local form, mobile and landline", () => {
  assert.equal(formatPhoneForDisplay("972501234567"), "050-123-4567");
  assert.equal(formatPhoneForDisplay("+972 50-123-4567"), "050-123-4567");
  assert.equal(formatPhoneForDisplay("97231234567"), "03-123-4567");
});

test("other numbers keep their international prefix", () => {
  assert.equal(formatPhoneForDisplay("447700900123"), "+447700900123");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOwnerSession, customerOfSession, peerIdOf, waIdOf } from "./session-peer.js";

test("only our +E.164 direct peers are customers; other channels' ids never match", () => {
  assert.equal(customerOfSession("agent:main:direct:+972501234567"), "972501234567");
  assert.equal(customerOfSession("agent:main:direct:123456789"), null);
  assert.equal(customerOfSession("agent:main:direct:owner"), null);
  assert.equal(customerOfSession(undefined), null);
  assert.equal(peerIdOf(waIdOf("+972501234567")), "+972501234567");
});

test("owner-only tools refuse a customer's session even if the policy let the call through", () => {
  assert.throws(() => assertOwnerSession("agent:main:direct:+972501234567"), /business owner/);
  assert.doesNotThrow(() => assertOwnerSession("agent:main:direct:123456789"));
  assert.doesNotThrow(() => assertOwnerSession("agent:main:main"));
});

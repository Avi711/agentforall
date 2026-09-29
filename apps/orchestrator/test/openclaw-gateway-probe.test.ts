import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS_STATUS_CALL, whatsappLinkStateOf } from "../src/services/agent-runtime/openclaw/gateway-probe.js";

const withAccount = (account: unknown) =>
  whatsappLinkStateOf({ status: "ok", payload: { channelAccounts: { whatsapp: [account] } } }, "whatsapp");

test("the probe asks for the unfiltered channel listing with read scope only", () => {
  assert.deepEqual(CHANNELS_STATUS_CALL, { method: "channels.status", params: {}, scopes: ["operator.read"] });
});

test("a linked and connected account reads as connected", () => {
  assert.equal(withAccount({ linked: true, connected: true, name: "main" }), "connected");
});

test("an unlinked, disconnected or unregistered account reads as disconnected", () => {
  assert.equal(withAccount({ linked: false, connected: true }), "disconnected");
  assert.equal(withAccount({ linked: true, connected: false }), "disconnected");
  assert.equal(whatsappLinkStateOf({ status: "ok", payload: { channelAccounts: {} } }, "whatsapp"), "disconnected");
  assert.equal(whatsappLinkStateOf({ status: "ok", payload: { channelAccounts: { whatsapp: [] } } }, "whatsapp"), "disconnected");
});

test("an account the gateway will not describe stays unknown, not disconnected", () => {
  assert.equal(withAccount({}), "unknown");
});

test("a probe that got no answer is probe_failed, never disconnected", () => {
  assert.equal(whatsappLinkStateOf({ status: "unreachable", reason: "timeout" }, "whatsapp"), "probe_failed");
  assert.equal(whatsappLinkStateOf({ status: "refused", code: "UNAVAILABLE", reason: "starting" }, "whatsapp"), "probe_failed");
});

test("an account in a shape we do not know is protocol_error", () => {
  // Guards against an upstream shape change degrading silently into a wrong answer.
  assert.equal(withAccount({ linked: "true" }), "protocol_error");
  assert.equal(withAccount("linked"), "protocol_error");
});

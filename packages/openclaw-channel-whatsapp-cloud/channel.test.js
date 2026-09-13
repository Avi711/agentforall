import { test } from "node:test";
import assert from "node:assert/strict";
import { createWhatsappCloudPlugin, CHANNEL_ID } from "./channel-definition.js";

// Mirrors the 2026.8.2 SDK: createChannelPluginBase copies a fixed key list (no status, no gateway) and
// createChatChannelPlugin spreads `base`. A plugin that hands gateway/status to the base helper loses them.
const BASE_KEYS = ["setupWizard", "capabilities", "commands", "doctor", "reload", "config", "security", "groups", "setup"];
const sdk = {
  createChannelPluginBase: (params) => ({
    id: params.id,
    meta: { ...params.meta, id: params.id },
    ...Object.fromEntries(BASE_KEYS.filter((k) => params[k]).map((k) => [k, params[k]])),
  }),
  createChatChannelPlugin: (params) => ({
    ...params.base,
    ...(params.security ? { security: params.security } : {}),
    ...(params.outbound ? { outbound: params.outbound } : {}),
  }),
  dispatchInboundDirectDm: async () => {},
};

test("the gateway can start and stop the account, and the status surfaces survive the SDK helpers", () => {
  const plugin = createWhatsappCloudPlugin(sdk);
  assert.equal(plugin.id, CHANNEL_ID);
  assert.equal(typeof plugin.gateway?.startAccount, "function");
  assert.equal(typeof plugin.gateway?.stopAccount, "function");
  assert.equal(typeof plugin.status?.probeAccount, "function");
  assert.equal(typeof plugin.status?.buildAccountSnapshot, "function");
  assert.equal(typeof plugin.config?.listAccountIds, "function");
  assert.equal(typeof plugin.outbound?.attachedResults?.sendText, "function");
});

test("an account is listed, resolved and reported not running until the gateway starts it", () => {
  const plugin = createWhatsappCloudPlugin(sdk);
  const cfg = {
    channels: { whatsapp_cloud: { accounts: { default: { phoneNumberId: "1", displayPhoneNumber: "+15550001", relayUrl: "http://relay" } } } },
  };
  assert.deepEqual(plugin.config.listAccountIds(cfg), ["default"]);
  const account = plugin.config.resolveAccount(cfg, "default");
  assert.equal(account.phoneNumberId, "1");
  const snapshot = plugin.status.buildAccountSnapshot({ account });
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.connected, false);
});

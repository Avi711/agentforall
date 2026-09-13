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

const CFG = {
  channels: { whatsapp_cloud: { accounts: { default: { phoneNumberId: "1", displayPhoneNumber: "+15550001", relayUrl: "http://relay" } } } },
};

// A relay whose long poll answers only when the caller gives up, like the orchestrator's 25 s wait; 401 when told to.
function fakeRelay({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(url);
    if (status !== 200) return Promise.resolve(new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status }));
    return new Promise((resolve) => {
      init.signal.addEventListener("abort", () => resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })), { once: true });
    });
  };
  return { fetchImpl, calls };
}

function settled(promise) {
  return Promise.race([promise.then(() => "settled", () => "settled"), new Promise((r) => setTimeout(() => r("pending"), 50))]);
}

test("startAccount stays pending while polling and settles once stopAccount ran", async () => {
  process.env.WHATSAPP_CLOUD_RELAY_TOKEN = "t";
  const relay = fakeRelay();
  const plugin = createWhatsappCloudPlugin({ ...sdk, fetchImpl: relay.fetchImpl });
  const account = plugin.config.resolveAccount(CFG, "default");
  const ctx = { cfg: CFG, account, abortSignal: new AbortController().signal, log: null };

  const running = plugin.gateway.startAccount(ctx);
  assert.equal(await settled(running), "pending");
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, true);
  assert.ok(relay.calls.length >= 1);

  await plugin.gateway.stopAccount(ctx);
  await running;
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, false);
});

test("the gateway's abort stops the loop and settles startAccount", async () => {
  process.env.WHATSAPP_CLOUD_RELAY_TOKEN = "t";
  const relay = fakeRelay();
  const plugin = createWhatsappCloudPlugin({ ...sdk, fetchImpl: relay.fetchImpl });
  const account = plugin.config.resolveAccount(CFG, "default");
  const abort = new AbortController();

  const running = plugin.gateway.startAccount({ cfg: CFG, account, abortSignal: abort.signal, log: null });
  assert.equal(await settled(running), "pending");
  abort.abort();
  await running;
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, false);
});

test("a revoked relay token ends the run with an error the gateway can show", async () => {
  process.env.WHATSAPP_CLOUD_RELAY_TOKEN = "t";
  const relay = fakeRelay({ status: 401 });
  const plugin = createWhatsappCloudPlugin({ ...sdk, fetchImpl: relay.fetchImpl });
  const account = plugin.config.resolveAccount(CFG, "default");

  await assert.rejects(plugin.gateway.startAccount({ cfg: CFG, account, abortSignal: new AbortController().signal, log: null }), /rejected the token/);
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, false);
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

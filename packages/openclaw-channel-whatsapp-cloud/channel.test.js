import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createWhatsappCloudPlugin, CHANNEL_ID } from "./channel-definition.js";

// Mirrors the 2026.8.2 SDK: createChannelPluginBase copies a fixed key list (no status, no gateway) and
// createChatChannelPlugin spreads `base`. A plugin that hands gateway/status to the base helper loses them.
const BASE_KEYS = [
  "setupWizard", "capabilities", "commands", "doctor", "agentPrompt", "streaming", "reload", "gatewayMethods",
  "gatewayMethodDescriptors", "configSchema", "config", "security", "groups", "setup", "setupContract",
];
const sdk = {
  createChannelPluginBase: (params) => ({
    id: params.id,
    meta: { ...params.meta, id: params.id },
    ...Object.fromEntries(BASE_KEYS.filter((k) => params[k]).map((k) => [k, params[k]])),
  }),
  createChatChannelPlugin: (params) => ({
    ...params.base,
    conversationBindings: { supportsCurrentConversationBinding: true, ...params.base.conversationBindings },
    ...(params.security ? { security: params.security } : {}),
    ...(params.pairing ? { pairing: params.pairing } : {}),
    ...(params.threading ? { threading: params.threading } : {}),
    ...(params.outbound ? { outbound: params.outbound } : {}),
  }),
  dispatch: async () => {},
};

const CFG = {
  channels: { whatsapp_cloud: { accounts: { default: { phoneNumberId: "1", displayPhoneNumber: "+15550001", relayUrl: "http://relay" } } } },
};

before(() => {
  process.env.WHATSAPP_CLOUD_RELAY_TOKEN = "t";
});
after(() => {
  delete process.env.WHATSAPP_CLOUD_RELAY_TOKEN;
});

// A relay whose long poll answers only when the caller gives up, like the orchestrator's 25 s wait.
// `answers` empty batches first; `status` other than 200 answers every call with that status.
function fakeRelay({ status = 200, answers = 0 } = {}) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(url);
    if (status !== 200) return Promise.resolve(new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status }));
    if (calls.length <= answers) return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    return new Promise((resolve) => {
      init.signal.addEventListener("abort", () => resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })), { once: true });
    });
  };
  return { fetchImpl, calls };
}

function settled(promise) {
  return Promise.race([promise.then(() => "settled", () => "settled"), new Promise((r) => setTimeout(() => r("pending"), 50))]);
}

function pluginWith(relay) {
  const plugin = createWhatsappCloudPlugin({ ...sdk, fetchImpl: relay.fetchImpl });
  const account = plugin.config.resolveAccount(CFG, "default");
  const statuses = [];
  const ctx = (abortSignal = new AbortController().signal, setStatus = (s) => statuses.push(s)) => ({ cfg: CFG, account, abortSignal, log: null, setStatus });
  return { plugin, account, statuses, ctx };
}

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

test("startAccount stays pending while polling, reports ready once, and settles once stopAccount ran", async () => {
  const relay = fakeRelay({ answers: 1 });
  const { plugin, account, statuses, ctx } = pluginWith(relay);
  const c = ctx();

  const running = plugin.gateway.startAccount(c);
  assert.equal(await settled(running), "pending");
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, true);
  assert.ok(relay.calls.length >= 2);
  assert.equal(statuses.length, 1);
  assert.deepEqual({ ...statuses[0], lastConnectedAt: "at" }, { accountId: "default", connected: true, lastError: null, lifecycle: "ready", lastConnectedAt: "at" });

  await plugin.gateway.stopAccount(c);
  await running;
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, false);
});

test("the gateway's abort stops the loop and settles startAccount; a stopAccount after it is a no-op", async () => {
  const { plugin, account, ctx } = pluginWith(fakeRelay());
  const abort = new AbortController();
  const c = ctx(abort.signal);

  const running = plugin.gateway.startAccount(c);
  assert.equal(await settled(running), "pending");
  abort.abort();
  await running;
  await plugin.gateway.stopAccount(c);
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, false);
});

test("an abort that landed while the setup was queued still stops the loop", async () => {
  const { plugin, account, ctx } = pluginWith(fakeRelay());
  const aborted = new AbortController();
  aborted.abort();

  await plugin.gateway.startAccount(ctx(aborted.signal));
  assert.equal(plugin.status.buildAccountSnapshot({ account }).running, false);
});

test("a revoked relay token ends the run as blocked, and the snapshot keeps saying so from the gateway's record", async () => {
  const { plugin, account, statuses, ctx } = pluginWith(fakeRelay({ status: 401 }));

  await assert.rejects(plugin.gateway.startAccount(ctx()), /rejected the token/);
  assert.deepEqual(statuses, [
    { accountId: "default", connected: false, lastError: "relay 401 UNAUTHORIZED", linked: false, lifecycle: "blocked", terminalDisconnect: true },
  ]);
  const snapshot = plugin.status.buildAccountSnapshot({ account, runtime: { lastError: "gone", terminalDisconnect: true } });
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.linked, false);
  assert.equal(snapshot.lifecycle, "blocked");
  assert.equal(snapshot.lastError, "gone");
});

test("a status sink that throws neither ends the run nor reads as a poll failure", async () => {
  const relay = fakeRelay({ answers: 1 });
  const { plugin, account, ctx } = pluginWith(relay);
  const c = ctx(undefined, () => {
    throw new Error("sink down");
  });

  const running = plugin.gateway.startAccount(c);
  assert.equal(await settled(running), "pending");
  assert.ok(relay.calls.length >= 2);
  const snapshot = plugin.status.buildAccountSnapshot({ account });
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.lastError, null);

  await plugin.gateway.stopAccount(c);
  await running;
});

test("an account is listed, resolved and reported not running until the gateway starts it", () => {
  const plugin = createWhatsappCloudPlugin(sdk);
  assert.deepEqual(plugin.config.listAccountIds(CFG), ["default"]);
  const account = plugin.config.resolveAccount(CFG, "default");
  assert.equal(account.phoneNumberId, "1");
  const snapshot = plugin.status.buildAccountSnapshot({ account });
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.connected, false);
});

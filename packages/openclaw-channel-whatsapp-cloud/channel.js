import { createChannelPluginBase, createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import { CHANNEL_ID, CHANNEL_LABEL, handleInbound } from "./inbound-turn.js";
import { PollLoop } from "./poll-loop.js";
import { RelayClient } from "./relay-client.js";
import { ReplyQueue } from "./reply-queue.js";
import { waIdOf } from "./session-peer.js";

export { CHANNEL_ID, CHANNEL_LABEL };
export const RELAY_TOKEN_ENV = "WHATSAPP_CLOUD_RELAY_TOKEN";
const DEFAULT_ACCOUNT_ID = "default";

let pluginRuntime = null;
const loops = new Map();
const accountOps = new Map();

export function setChannelRuntime(runtime) {
  pluginRuntime = runtime;
}

export function resolveAccount(cfg, accountId) {
  const block = cfg?.channels?.[CHANNEL_ID] ?? {};
  const id = accountId || block.defaultAccount || DEFAULT_ACCOUNT_ID;
  const account = block.accounts?.[id] ?? {};
  return {
    accountId: id,
    enabled: block.enabled !== false && account.enabled !== false,
    phoneNumberId: typeof account.phoneNumberId === "string" ? account.phoneNumberId : null,
    displayPhoneNumber: typeof account.displayPhoneNumber === "string" ? account.displayPhoneNumber : null,
    relayUrl: typeof account.relayUrl === "string" ? account.relayUrl : null,
    relayToken: process.env[RELAY_TOKEN_ENV] ?? null,
    dmPolicy: typeof block.dmPolicy === "string" ? block.dmPolicy : "open",
    allowFrom: Array.isArray(block.allowFrom) ? block.allowFrom : ["*"],
  };
}

export function isConfigured(account) {
  return Boolean(account.phoneNumberId && account.relayUrl && account.relayToken);
}

export function createRelayFor(account, fetchImpl) {
  return new RelayClient({ baseUrl: account.relayUrl, token: account.relayToken, fetchImpl });
}

// Hot reloads can start and stop the same account back to back; each step waits for the previous one.
function serialized(accountId, step) {
  const run = (accountOps.get(accountId) ?? Promise.resolve()).then(step);
  accountOps.set(
    accountId,
    run.catch(() => {}),
  );
  return run;
}

function snapshotOf(account, loop) {
  const configured = isConfigured(account);
  const state = loop?.state;
  return {
    accountId: account.accountId,
    name: account.displayPhoneNumber ?? undefined,
    enabled: account.enabled,
    configured,
    linked: configured && !state?.unauthorized,
    running: Boolean(loop),
    connected: Boolean(state?.connected),
    lastError: state?.lastError ?? null,
    lifecycle: !configured ? "stopped" : state?.unauthorized ? "blocked" : state?.connected ? "ready" : loop ? "starting" : "stopped",
  };
}

async function startAccount(ctx) {
  const account = ctx.account;
  if (!isConfigured(account)) {
    ctx.log?.warn?.(`${CHANNEL_LABEL}: account ${account.accountId} is not configured; not starting`);
    return;
  }
  await loops.get(account.accountId)?.stop();
  const relay = createRelayFor(account);
  const replies = new ReplyQueue();
  const loop = new PollLoop({
    relay,
    log: ctx.log,
    handle: (item) => {
      if (!pluginRuntime) throw new Error("channel runtime not set");
      return handleInbound({ cfg: ctx.cfg, account, relay, item, log: ctx.log, replies, runtime: pluginRuntime, dispatch: dispatchInboundDirectDmWithRuntime });
    },
  });
  loops.set(account.accountId, loop);
  loop.start();
  ctx.log?.info?.(`${CHANNEL_LABEL}: polling for ${account.displayPhoneNumber ?? account.phoneNumberId}`);
}

async function stopAccount(ctx) {
  const loop = loops.get(ctx.account.accountId);
  loops.delete(ctx.account.accountId);
  await loop?.stop();
}

export const whatsappCloudPlugin = createChatChannelPlugin({
  base: createChannelPluginBase({
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: CHANNEL_LABEL,
      selectionLabel: "WhatsApp Business (Meta Cloud API)",
      docsPath: "/channels/whatsapp",
      blurb: "the business number customers write to, through Meta's official API.",
      markdownCapable: false,
    },
    capabilities: { chatTypes: ["direct"], media: false, reactions: false, polls: false, threads: false },
    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
    config: {
      listAccountIds: (cfg) => Object.keys(cfg?.channels?.[CHANNEL_ID]?.accounts ?? {}),
      resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
      defaultAccountId: (cfg) => cfg?.channels?.[CHANNEL_ID]?.defaultAccount ?? DEFAULT_ACCOUNT_ID,
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => isConfigured(account),
      isLinked: (account) => (isConfigured(account) ? "linked" : "not-linked"),
      unconfiguredReason: () => "connect a WhatsApp Business number from the agent-forall dashboard",
      unlinkedReason: () => "no relay credentials for this number",
      describeAccount: (account) => snapshotOf(account, loops.get(account.accountId)),
      resolveAllowFrom: () => ["*"],
    },
    status: {
      probeAccount: async ({ account }) => {
        const loop = loops.get(account.accountId);
        return { connected: Boolean(loop?.state.connected), lastPollAt: loop?.state.lastPollAt ?? null };
      },
      buildAccountSnapshot: ({ account }) => snapshotOf(account, loops.get(account.accountId)),
    },
    gateway: {
      startAccount: (ctx) => serialized(ctx.account.accountId, () => startAccount(ctx)),
      stopAccount: (ctx) => serialized(ctx.account.accountId, () => stopAccount(ctx)),
    },
  }),
  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: (account) => account.dmPolicy,
      resolveAllowFrom: (account) => account.allowFrom,
      defaultPolicy: "open",
    },
  },
  outbound: {
    // The runtime's own chunking never runs on the direct deliver path; chunkText splits replies at Meta's limit.
    base: { deliveryMode: "direct" },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId, replyToId }) => {
        const account = resolveAccount(cfg, accountId);
        if (!isConfigured(account)) throw new Error(`${CHANNEL_LABEL}: account is not configured`);
        const wamid = await createRelayFor(account).sendText({ to: waIdOf(to), text, replyToId: replyToId ?? undefined, kind: "owner" });
        return { messageId: wamid, target: { kind: "chat", id: to } };
      },
    },
  },
});

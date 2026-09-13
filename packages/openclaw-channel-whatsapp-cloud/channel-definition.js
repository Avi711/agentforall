import { CHANNEL_ID, CHANNEL_LABEL, handleInbound } from "./inbound-turn.js";
import { PollLoop } from "./poll-loop.js";
import { RelayClient, errorLabel } from "./relay-client.js";
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
  // The chain must outlive a failed step; the caller still sees that failure through `run`.
  accountOps.set(
    accountId,
    run.catch(() => {}),
  );
  return run;
}

// With no loop in the map (after a stop or a revoked token) the gateway's own record is the truth.
function snapshotOf(account, loop, runtime) {
  const configured = isConfigured(account);
  const state = loop?.state;
  const blocked = state ? state.unauthorized : runtime?.terminalDisconnect === true;
  return {
    accountId: account.accountId,
    name: account.displayPhoneNumber ?? undefined,
    enabled: account.enabled,
    configured,
    linked: configured && !blocked,
    running: Boolean(loop),
    connected: Boolean(state?.connected),
    lastError: state?.lastError ?? runtime?.lastError ?? null,
    lifecycle: !configured ? "stopped" : blocked ? "blocked" : state?.connected ? "ready" : loop ? "starting" : "stopped",
  };
}

// What the gateway's status store is told, in the shape the bundled plugins use; blocked is terminal, so no auto-restart.
function statusPatch(accountId, state) {
  const at = Date.now();
  if (state.unauthorized) {
    return { accountId, connected: false, lastError: state.lastError, linked: false, lifecycle: "blocked", terminalDisconnect: true };
  }
  if (state.connected) return { accountId, connected: true, lastError: null, lifecycle: "ready", lastConnectedAt: at };
  return { accountId, connected: false, lastError: state.lastError, lifecycle: "recovering", lastDisconnect: { at, error: state.lastError } };
}

// Settles only once the loop is stopped (stopAccount, the gateway's abort, a revoked token): a settled start reads as an exit.
async function startAccount(ctx, dispatch, fetchImpl) {
  const account = ctx.account;
  if (!isConfigured(account)) throw new Error(`${CHANNEL_LABEL}: account ${account.accountId} is not configured`);
  const loop = await serialized(account.accountId, async () => {
    await loops.get(account.accountId)?.stop();
    const relay = createRelayFor(account, fetchImpl);
    const replies = new ReplyQueue();
    const started = new PollLoop({
      relay,
      log: ctx.log,
      onState: (state) => ctx.setStatus?.(statusPatch(account.accountId, state)),
      handle: (item) => {
        if (!pluginRuntime) throw new Error("channel runtime not set");
        return handleInbound({ cfg: ctx.cfg, account, relay, item, log: ctx.log, replies, runtime: pluginRuntime, dispatch });
      },
    });
    loops.set(account.accountId, started);
    started.start();
    ctx.log?.info?.(`${CHANNEL_LABEL}: polling for ${account.displayPhoneNumber ?? account.phoneNumberId}`);
    return started;
  });
  const onAbort = () => {
    serialized(account.accountId, () => releaseLoop(account.accountId, loop)).catch((err) =>
      ctx.log?.warn?.(`${CHANNEL_LABEL}: stop after abort failed: ${errorLabel(err)}`),
    );
  };
  ctx.abortSignal?.addEventListener("abort", onAbort, { once: true });
  // An abort that landed while the setup was queued fires no event.
  if (ctx.abortSignal?.aborted) onAbort();
  try {
    await loop.done;
  } finally {
    ctx.abortSignal?.removeEventListener("abort", onAbort);
    if (loops.get(account.accountId) === loop) loops.delete(account.accountId);
  }
  if (loop.state.unauthorized) throw new Error(`${CHANNEL_LABEL}: the relay rejected the token; connect the number again from the dashboard`);
}

async function releaseLoop(accountId, loop) {
  if (loops.get(accountId) === loop) loops.delete(accountId);
  await loop.stop();
}

async function stopAccount(ctx) {
  const loop = loops.get(ctx.account.accountId);
  if (loop) await releaseLoop(ctx.account.accountId, loop);
}

// SDK helpers injected so this is testable without the openclaw package; fetchImpl is for tests.
export function createWhatsappCloudPlugin({ createChannelPluginBase, createChatChannelPlugin, dispatch, fetchImpl }) {
  return createChatChannelPlugin({
    // createChannelPluginBase copies a fixed key list without status and gateway; they sit beside it, as in the bundled plugin.
    base: {
      ...createChannelPluginBase({
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
      }),
      status: {
        probeAccount: async ({ account }) => {
          const loop = loops.get(account.accountId);
          return { connected: Boolean(loop?.state.connected), lastPollAt: loop?.state.lastPollAt ?? null };
        },
        buildAccountSnapshot: ({ account, runtime }) => snapshotOf(account, loops.get(account.accountId), runtime),
      },
      gateway: {
        startAccount: (ctx) => startAccount(ctx, dispatch, fetchImpl),
        stopAccount: (ctx) => serialized(ctx.account.accountId, () => stopAccount(ctx)),
      },
    },
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
}

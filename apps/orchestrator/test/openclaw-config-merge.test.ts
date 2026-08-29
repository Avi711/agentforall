import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
} from "../src/services/agent-runtime/openclaw/config.js";
import { configWith } from "./helpers/fixtures.js";
import type { ChannelConfig } from "../src/domain/types.js";

interface Patched {
  channels: Record<string, Record<string, unknown> | undefined>;
  tools?: { media?: Record<string, unknown> };
  plugins?: { allow?: string[]; entries?: Record<string, unknown> };
  web?: unknown;
  browser?: unknown;
  logging?: unknown;
  agents?: { defaults?: Record<string, unknown>; list?: unknown };
  mcp?: unknown;
  messages?: unknown;
}

function patch(existing: unknown, channels: ChannelConfig[]): Patched {
  const files = generateRuntimePatchedOpenclawFiles(
    JSON.stringify(existing),
    configWith(channels),
    "token",
  );
  return JSON.parse(files.configJson) as Patched;
}

// A rotated credential is the whole point of the write: letting the on-disk value win means a
// customer revokes a leaked token and the container keeps using it.
test("a rotated channel token replaces the one on disk", () => {
  const existing = {
    channels: {
      discord: { enabled: true, token: "leaked-discord", groupPolicy: "allowlist" },
      slack: { enabled: true, botToken: "leaked-bot", appToken: "leaked-app" },
    },
  };
  const patched = patch(existing, [
    { type: "discord", token: "rotated-discord" },
    { type: "slack", botToken: "rotated-bot", appToken: "rotated-app" },
  ]);

  assert.equal(patched.channels.discord?.token, "rotated-discord");
  assert.equal(patched.channels.slack?.botToken, "rotated-bot");
  assert.equal(patched.channels.slack?.appToken, "rotated-app");
});

test("a removed channel is gone, not resurrected from disk", () => {
  const existing = {
    channels: {
      discord: { enabled: true, token: "old" },
      slack: { enabled: true, botToken: "b", appToken: "a" },
      telegram: { enabled: true, botToken: "t" },
    },
  };
  const patched = patch(existing, [{ type: "whatsapp" }]);

  assert.equal(patched.channels.discord, undefined);
  assert.equal(patched.channels.slack, undefined);
  assert.equal(patched.channels.telegram, undefined);
});

// The runtime writes its own WhatsApp account state; losing it would unlink the device.
test("runtime-written whatsapp state survives while access policy stays orchestrator-owned", () => {
  const existing = {
    channels: {
      whatsapp: {
        enabled: true,
        dmPolicy: "open",
        allowFrom: ["*"],
        accounts: { default: { enabled: true, authDir: "/home/node/.openclaw/whatsapp-session" } },
      },
    },
  };
  const patched = patch(existing, [{ type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" }]);

  assert.deepEqual(patched.channels.whatsapp?.accounts, {
    default: { enabled: true, authDir: "/home/node/.openclaw/whatsapp-session" },
  });
  assert.equal(patched.channels.whatsapp?.dmPolicy, "allowlist");
  assert.deepEqual(patched.channels.whatsapp?.allowFrom, ["+972501234567"]);
});

// The container is the tenant's: they and the runtime both write to this file, and a config change
// must not be a silent factory reset. This is the whole point of the owned-paths patch.
test("settings the dashboard does not render survive a config change untouched", () => {
  const existing = {
    web: { reconnect: { maxMs: 30000 } },
    browser: { headless: false },
    logging: { redactSensitive: "none" },
    agents: { defaults: { model: "stale", maxConcurrent: 8 }, list: [{ id: "main" }, { id: "side" }] },
  };
  const patched = patch(existing, [{ type: "whatsapp" }]);

  assert.deepEqual(patched.web, { reconnect: { maxMs: 30000 } });
  assert.deepEqual(patched.browser, { headless: false });
  assert.deepEqual(patched.logging, { redactSensitive: "none" });
  assert.deepEqual(patched.agents?.list, [{ id: "main" }, { id: "side" }]);
  assert.equal(patched.agents?.defaults?.maxConcurrent, 8);
  // The model is the one field under agents the dashboard does render.
  assert.deepEqual(patched.agents?.defaults?.model, { primary: "openai/gpt-5" });
});

// The bug this whole change exists for: OpenClaw writes group allowlists into the telegram block
// itself, and replacing the block wholesale deleted them.
test("a group allowlist the runtime wrote survives a telegram credential change", () => {
  const existing = {
    channels: {
      telegram: {
        enabled: true,
        botToken: "old",
        groups: { "-5312959760": { requireMention: false } },
        groupPolicy: "allowlist",
      },
    },
  };
  const patched = patch(existing, [{ type: "telegram", botToken: "new" }]);

  assert.equal(patched.channels.telegram?.botToken, "new");
  assert.deepEqual(patched.channels.telegram?.groups, {
    "-5312959760": { requireMention: false },
  });
  assert.equal(patched.channels.telegram?.groupPolicy, "allowlist");
});

// Group access is a creation-time default, not a dashboard control. An owner who shut groups off
// keeps them off: re-asserting our default would silently reopen the bot to every group member.
test("an owner who turned groups off is not overridden by a config change", () => {
  const existing = {
    channels: {
      telegram: {
        enabled: true,
        botToken: "t",
        groupPolicy: "disabled",
        groups: { "*": { requireMention: false } },
      },
    },
  };
  const patched = patch(existing, [{ type: "telegram", botToken: "t" }]);

  assert.equal(patched.channels.telegram?.groupPolicy, "disabled");
  assert.deepEqual(patched.channels.telegram?.groups, { "*": { requireMention: false } });
});

// Telegram is never part of creation: the bot link attaches it later through this patch path, so
// if the group defaults were not delivered here they would never be delivered at all.
test("linking telegram to a bot that had none delivers the group defaults", () => {
  const existing = { channels: { whatsapp: { enabled: true, dmPolicy: "open" } } };
  const patched = patch(existing, [{ type: "whatsapp" }, { type: "telegram", botToken: "t" }]);

  assert.equal(patched.channels.telegram?.groupPolicy, "open");
  assert.deepEqual(patched.channels.telegram?.groups, { "*": { requireMention: true } });
});

// A bot whose owner approved one group from the chat before the defaults existed has a `groups`
// map and no `groupPolicy`. Delivering the policy is safe: `groups` is the group allowlist and
// stays as it is, so no other group opens; `groupPolicy` only widens who may talk inside the
// groups already listed, which OpenClaw's own default already allows for an explicit entry.
test("a runtime-written group allowlist keeps its groups and gains only the missing policy", () => {
  const existing = {
    channels: {
      telegram: { enabled: true, botToken: "t", groups: { "-5312959760": { requireMention: false } } },
    },
  };
  const patched = patch(existing, [{ type: "telegram", botToken: "t" }]);

  assert.equal(patched.channels.telegram?.groupPolicy, "open");
  assert.deepEqual(patched.channels.telegram?.groups, { "-5312959760": { requireMention: false } });
});

// The state of every bot linked before the defaults existed: a telegram block with neither key.
// Deciding per block would leave them silent in groups forever; deciding per key reaches them.
test("a telegram block that predates the group defaults receives them", () => {
  const existing = {
    channels: { telegram: { enabled: true, botToken: "t", errorPolicy: "once" } },
  };
  const patched = patch(existing, [{ type: "telegram", botToken: "t" }]);

  assert.equal(patched.channels.telegram?.groupPolicy, "open");
  assert.deepEqual(patched.channels.telegram?.groups, { "*": { requireMention: true } });
});

test("the plugin a channel needs is enabled without dropping the runtime's other plugins", () => {
  const existing = { plugins: { entries: { somethingElse: { enabled: true } } } };
  const patched = patch(existing, [{ type: "whatsapp" }]);

  assert.deepEqual(patched.plugins?.entries, {
    somethingElse: { enabled: true },
    whatsapp: { enabled: true },
    "agentforall-credit": {
      enabled: true,
      hooks: { allowConversationAccess: true, timeoutMs: 3000 },
    },
    "agentforall-media": { enabled: true },
  });
});

// Voice notes reach the model only through this plugin: OpenClaw registers a config provider for
// image alone, so without it transcription falls back to a local whisper the image does not carry.
test("the media plugin ships on every bot", () => {
  const patched = patch({}, [{ type: "telegram", botToken: "t" }]);

  assert.deepEqual(patched.plugins?.entries?.["agentforall-media"], { enabled: true });
});

// `tools` is ours to render, so a block we stopped rendering has to disappear from a live config —
// a stale video entry would keep promising a capability the runtime cannot serve.
test("a media block the orchestrator no longer renders is dropped from the live config", () => {
  const existing = {
    tools: { media: { video: { enabled: true, models: [{ provider: "litellm", model: "old" }] } } },
  };
  const patched = patchGateway(existing);

  assert.equal(patched.tools?.media?.video, undefined);
  assert.ok(patched.tools?.media?.audio, "audio is still rendered");
});

// Without allowConversationAccess the plugin never receives before_agent_reply, so it would
// silently stop answering when the budget runs out — the one case it exists for.
test("the credit plugin ships on every bot with conversation access", () => {
  const patched = patch({}, [{ type: "telegram", botToken: "t" }]);
  const credit = patched.plugins?.entries?.["agentforall-credit"] as
    | { enabled: boolean; hooks?: { allowConversationAccess?: boolean } }
    | undefined;

  assert.equal(credit?.enabled, true);
  assert.equal(credit?.hooks?.allowConversationAccess, true);
});

// `plugins.allow` looks like a trust pin for our plugin but OpenClaw treats it as the whole plugin
// set: a live gateway went from 10 plugins to 3, losing memory-core. It must never be rendered,
// and a tenant who set it themselves keeps it.
test("plugins.allow is never written and a tenant's own value is left alone", () => {
  assert.equal(patch({}, [{ type: "whatsapp" }]).plugins?.allow, undefined);

  const existing = { plugins: { allow: ["their-plugin"], entries: {} } };
  assert.deepEqual(patch(existing, [{ type: "whatsapp" }]).plugins?.allow, ["their-plugin"]);
});

// Anything the runtime writes that the orchestrator does not render must survive untouched.
test("config the orchestrator does not render is left alone", () => {
  const existing = {
    mcp: { servers: { local: { command: "x" } } },
    messages: { history: 50 },
  };
  const patched = patch(existing, [{ type: "whatsapp" }]);

  assert.deepEqual(patched.mcp, { servers: { local: { command: "x" } } });
  assert.deepEqual(patched.messages, { history: 50 });
});

// The patch delivers a fixed list of paths. A field added to the generator but not to that list
// would silently never reach a container that already exists, which is invisible until a customer
// reports it — so patching an empty config must reproduce everything the generator renders.
const FROZEN_AFTER_CREATION = ["web", "browser", "logging"];

test("every field the generator renders is one a config change can deliver", () => {
  const cases: ChannelConfig[][] = [
    [{ type: "telegram", botToken: "t", allowFrom: ["123"] }],
    [{ type: "discord", token: "d", guildId: "g" }],
    [{ type: "slack", botToken: "b", appToken: "a" }],
    [{ type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" }],
  ];

  for (const channels of cases) {
    const pristine = JSON.parse(
      generateOpenclawFiles(configWith(channels), "token").configJson,
    ) as Record<string, unknown>;
    const deliverable: Record<string, unknown> = {
      ...pristine,
      agents: { defaults: { model: agentModel(pristine) } },
    };
    for (const key of FROZEN_AFTER_CREATION) delete deliverable[key];

    assert.deepEqual(patch({}, channels), deliverable, channels[0]?.type);
  }
});

// agents carries both rendered settings (the model) and creation-time ones (workspace, the agent
// list) that a running container keeps for itself.
function agentModel(pristine: Record<string, unknown>): unknown {
  const agents = pristine.agents as { defaults: { model: unknown } };
  return agents.defaults.model;
}

const RELAY = { relayToken: "relay-secret", relayUrl: "http://orchestrator:3000/api/v1/mcp/abc" };

// The default fixture is a direct provider; the media plugin only applies behind a gateway.
function patchGateway(existing: unknown): Patched {
  const base = configWith([{ type: "telegram", botToken: "t" }]);
  const files = generateRuntimePatchedOpenclawFiles(
    JSON.stringify(existing),
    {
      ...base,
      provider: { ...base.provider, baseUrl: "https://gateway.example/v1", media: ["image", "audio", "video"] },
    },
    "token",
  );
  return JSON.parse(files.configJson) as Patched;
}

function patchWithIntegrations(existing: unknown, integrations: typeof RELAY | undefined): Patched {
  const config = { ...configWith([{ type: "whatsapp" }]), ...(integrations ? { integrations } : {}) };
  const files = generateRuntimePatchedOpenclawFiles(JSON.stringify(existing), config, "token");
  return JSON.parse(files.configJson) as Patched;
}

test("binding the relay delivers our MCP entry beside the tenant's own servers", () => {
  const patched = patchWithIntegrations({ mcp: { servers: { local: { command: "x" } } } }, RELAY);

  assert.deepEqual(patched.mcp, {
    servers: {
      local: { command: "x" },
      agentforall: {
        transport: "streamable-http",
        url: RELAY.relayUrl,
        headers: { Authorization: "Bearer relay-secret" },
        requestTimeoutMs: 120_000,
        connectionTimeoutMs: 15_000,
      },
    },
  });
});

test("clearing the relay removes only our MCP entry", () => {
  const existing = {
    mcp: { servers: { local: { command: "x" }, agentforall: { transport: "streamable-http", url: "old" } } },
  };
  const patched = patchWithIntegrations(existing, undefined);

  assert.deepEqual(patched.mcp, { servers: { local: { command: "x" } } });
});

test("a config that never bound the relay renders no mcp block", () => {
  const pristine = JSON.parse(
    generateOpenclawFiles(configWith([{ type: "whatsapp" }]), "token").configJson,
  ) as Patched;
  assert.equal("mcp" in pristine, false);
});

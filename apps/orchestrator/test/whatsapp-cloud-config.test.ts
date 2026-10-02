import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
} from "../src/services/agent-runtime/openclaw/config.js";
import type { ChannelConfig } from "../src/domain/types.js";
import { RELAY_URLS, configWith, makeWhatsappCloudChannel } from "./helpers/fixtures.js";

interface Rendered {
  agents: {
    ownership?: string;
    defaults: { workspace: string; heartbeat: Record<string, unknown>; systemAgent?: { agentId: string } };
    entries: Record<string, Record<string, unknown>>;
  };
  bindings?: unknown[];
  channels: Record<string, Record<string, unknown> | undefined>;
  tools?: {
    exec?: { security: string };
    toolsBySender?: Record<string, { deny?: string[]; alsoAllow?: string[] }>;
    sessions?: { visibility: string };
    agentToAgent?: { enabled: boolean; allow: string[] };
  };
  plugins?: { entries?: Record<string, unknown> };
  session?: { identityLinks?: Record<string, string[]> };
  commands?: { ownerAllowFrom?: string[] };
}

const TELEGRAM: ChannelConfig = { type: "telegram", botToken: "tg-token", allowFrom: ["tg:123456"] };
const WHATSAPP_OWNED: ChannelConfig = { type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" };
const CLOUD = makeWhatsappCloudChannel();
const CLOUD_OWNED: ChannelConfig = { ...makeWhatsappCloudChannel(), ownerNumber: "+972541112222" };

function render(channels: ChannelConfig[]): { config: Rendered; dotEnv: string } {
  const files = generateOpenclawFiles(configWith(channels), "gw-token", RELAY_URLS);
  return { config: JSON.parse(files.configJson) as Rendered, dotEnv: files.dotEnv };
}

test("a business number renders the channel block with ids and the relay url but no secret", () => {
  const { config, dotEnv } = render([TELEGRAM, CLOUD]);
  assert.deepEqual(config.channels.whatsapp_cloud, {
    enabled: true,
    dmPolicy: "open",
    allowFrom: ["*"],
    defaultAccount: "default",
    accounts: {
      default: {
        enabled: true,
        phoneNumberId: "2000",
        displayPhoneNumber: "+972501112233",
        relayUrl: RELAY_URLS.whatsappCloud,
      },
    },
  });
  assert.equal(JSON.stringify(config).includes("meta-token"), false);
  assert.equal(JSON.stringify(config).includes("cloud-relay-token"), false);
  assert.equal(JSON.stringify(config).includes("246810"), false);
  assert.match(dotEnv, /^WHATSAPP_CLOUD_RELAY_TOKEN=cloud-relay-token$/m);
  assert.equal(dotEnv.includes("meta-token"), false);
});

test("the plugin and the stranger policy come with the channel; no gateway hooks endpoint is opened", () => {
  const { config } = render([TELEGRAM, WHATSAPP_OWNED, CLOUD_OWNED]);
  assert.deepEqual(config.plugins?.entries?.["agentforall-whatsapp-cloud"], { enabled: true });
  assert.equal("hooks" in config, false);
  assert.equal(config.tools?.exec?.security, "deny");

  const keys = Object.keys(config.tools?.toolsBySender ?? {});
  assert.deepEqual(keys, ["channel:telegram:123456", "e164:+972501234567", "channel:whatsapp_cloud:+972541112222", "*"]);
  assert.deepEqual(config.tools?.toolsBySender?.["channel:telegram:123456"], {});
  assert.deepEqual(config.tools?.toolsBySender?.["channel:whatsapp_cloud:+972541112222"], {});
  // Every policy group OpenClaw 2026.8.2 defines, by name, plus every MCP server and each plugin tool.
  // Never "group:plugins": it expands to the escalation too, and deny beats alsoAllow.
  const strangers = config.tools?.toolsBySender?.["*"];
  assert.deepEqual(strangers, {
    deny: [
      "group:runtime",
      "group:fs",
      "group:sessions",
      "group:messaging",
      "group:automation",
      "group:web",
      "group:ui",
      "group:media",
      "group:agents",
      "group:nodes",
      "group:memory",
      "group:openclaw",
      "bundle-mcp",
      "agentforall__*",
      "intent",
      "whatsapp_cloud_handoff",
      "whatsapp_cloud_reply",
    ],
    alsoAllow: ["whatsapp_cloud_escalate"],
  });
  assert.equal(strangers?.deny?.includes("group:plugins"), false);
});

test("the business number's owner phone joins the owner's session but is never printed for customers", () => {
  const { config } = render([WHATSAPP_OWNED, CLOUD_OWNED]);
  assert.deepEqual(config.session?.identityLinks?.owner, ["whatsapp:+972501234567", "whatsapp_cloud:+972541112222"]);
  assert.deepEqual(config.commands?.ownerAllowFrom, ["whatsapp:+972501234567"]);
});

test("the personal WhatsApp owner number no longer stands in for the business number's owner", () => {
  const { config } = render([WHATSAPP_OWNED, CLOUD]);
  assert.deepEqual(config.session?.identityLinks?.owner, ["whatsapp:+972501234567"]);
  assert.equal(Object.keys(config.tools?.toolsBySender ?? {}).includes("channel:whatsapp_cloud:+972501234567"), false);
});

test("a business number brings a separate business agent with its own workspace and one tool", () => {
  const { config } = render([TELEGRAM, CLOUD_OWNED]);
  assert.equal(config.agents.ownership, "explicit");
  assert.equal(config.agents.defaults.heartbeat.agentId, "main");
  assert.deepEqual(config.agents.defaults.systemAgent, { agentId: "main" });
  assert.equal(config.agents.entries.main?.workspace, config.agents.defaults.workspace, "the owner's workspace never moves");
  assert.deepEqual(config.agents.entries.business, {
    identity: { name: "Shop" },
    workspace: "/home/node/.openclaw/workspace-business",
    skills: [],
    memory: { search: { enabled: false } },
    tools: { allow: ["whatsapp_cloud_escalate"] },
  });
  assert.deepEqual(config.tools?.sessions, { visibility: "all" });
  assert.deepEqual(config.tools?.agentToAgent, { enabled: true, allow: ["main", "business"] });
  assert.deepEqual((config.plugins?.entries?.["memory-core"] as { config: unknown }).config, {
    dreaming: { enabled: true },
    memoryPolicy: { excludeSessions: { channels: ["whatsapp_cloud"] } },
  });
});

test("routing: the owner's phone to their agent, every other business sender to the business agent, all else to main", () => {
  assert.deepEqual(render([TELEGRAM, CLOUD_OWNED]).config.bindings, [
    { agentId: "main", match: { channel: "whatsapp_cloud", accountId: "*", peer: { kind: "direct", id: "+972541112222" } } },
    { agentId: "business", match: { channel: "whatsapp_cloud", accountId: "*" } },
    { agentId: "main", match: { channel: "telegram", accountId: "*" } },
  ]);
  assert.deepEqual(render([CLOUD]).config.bindings, [{ agentId: "business", match: { channel: "whatsapp_cloud", accountId: "*" } }]);
});

test("without a business number nothing of the roster or routing is rendered", () => {
  const { config } = render([TELEGRAM, WHATSAPP_OWNED]);
  assert.equal("ownership" in config.agents, false);
  assert.equal("bindings" in config, false);
  assert.equal("systemAgent" in config.agents.defaults, false);
  assert.equal("agentId" in config.agents.defaults.heartbeat, false);
  assert.deepEqual(Object.keys(config.agents.entries), ["main"]);
  assert.equal("workspace" in (config.agents.entries.main ?? {}), false);
  assert.equal(JSON.stringify(config.plugins?.entries?.["memory-core"]).includes("memoryPolicy"), false);
});

test("disconnecting the business number takes our roster and routing away; a tenant's own on other bots is left alone", () => {
  const connected = generateOpenclawFiles(configWith([TELEGRAM, CLOUD_OWNED]), "gw-token", RELAY_URLS).configJson;
  const disconnected = JSON.parse(
    generateRuntimePatchedOpenclawFiles(connected, configWith([TELEGRAM]), "gw-token", RELAY_URLS).configJson,
  ) as Rendered;
  assert.equal("bindings" in disconnected, false);
  assert.equal("ownership" in disconnected.agents, false);
  assert.equal("systemAgent" in disconnected.agents.defaults, false);
  assert.deepEqual(Object.keys(disconnected.agents.entries), ["main"]);
  assert.equal("workspace" in (disconnected.agents.entries.main ?? {}), false);

  const tenant = JSON.parse(generateOpenclawFiles(configWith([TELEGRAM]), "gw-token", RELAY_URLS).configJson) as Rendered;
  tenant.agents.ownership = "explicit";
  tenant.agents.entries.helper = { workspace: "/home/node/.openclaw/helper" };
  tenant.bindings = [{ agentId: "helper", match: { channel: "telegram", accountId: "*" } }];
  const kept = JSON.parse(
    generateRuntimePatchedOpenclawFiles(JSON.stringify(tenant), configWith([TELEGRAM]), "gw-token", RELAY_URLS).configJson,
  ) as Rendered;
  assert.equal(kept.agents.ownership, "explicit");
  assert.deepEqual(kept.bindings, tenant.bindings);
  assert.deepEqual(kept.agents.entries.helper, { workspace: "/home/node/.openclaw/helper" });
});

test("on a business bot a tenant's own agent keeps its bindings and its roster survives a disconnect", () => {
  const helperBinding = { agentId: "helper", match: { channel: "telegram", accountId: "*", peer: { kind: "direct", id: "777" } } };
  const live = JSON.parse(generateOpenclawFiles(configWith([TELEGRAM, CLOUD_OWNED]), "gw-token", RELAY_URLS).configJson) as Rendered;
  live.agents.entries.helper = { workspace: "/home/node/.openclaw/helper" };
  live.bindings = [helperBinding, ...(live.bindings ?? [])];

  const connected = JSON.parse(
    generateRuntimePatchedOpenclawFiles(JSON.stringify(live), configWith([TELEGRAM, CLOUD_OWNED]), "gw-token", RELAY_URLS).configJson,
  ) as Rendered;
  assert.deepEqual(connected.bindings?.[0], helperBinding);
  assert.equal(connected.bindings?.length, 4);

  const disconnected = JSON.parse(
    generateRuntimePatchedOpenclawFiles(JSON.stringify(connected), configWith([TELEGRAM]), "gw-token", RELAY_URLS).configJson,
  ) as Rendered;
  assert.deepEqual(disconnected.bindings, [helperBinding, { agentId: "main", match: { channel: "telegram", accountId: "*" } }]);
  assert.equal(disconnected.agents.ownership, "explicit", "two agents still need the marker");
  assert.equal(disconnected.agents.entries.main?.workspace, "/home/node/.openclaw/workspace");
  assert.deepEqual(disconnected.agents.defaults.systemAgent, { agentId: "main" });
  assert.equal(disconnected.agents.defaults.heartbeat.agentId, "main");
  assert.equal("business" in disconnected.agents.entries, false);

  const again = generateRuntimePatchedOpenclawFiles(JSON.stringify(disconnected), configWith([TELEGRAM]), "gw-token", RELAY_URLS).configJson;
  assert.deepEqual(JSON.parse(again), disconnected, "a second patch changes nothing");
});

test("a bot without a business number renders no channel, but the plugin entry stays so a connect can validate", () => {
  const { config, dotEnv } = render([TELEGRAM]);
  assert.equal(config.channels.whatsapp_cloud, undefined);
  assert.equal(config.tools?.toolsBySender, undefined);
  assert.deepEqual(config.plugins?.entries?.["agentforall-whatsapp-cloud"], { enabled: true });
  assert.equal(dotEnv.includes("WHATSAPP_CLOUD"), false);
});

test("disconnecting the business number removes its block, plugin and policy from the live config", () => {
  const live = JSON.parse(generateOpenclawFiles(configWith([TELEGRAM, CLOUD]), "gw-token", RELAY_URLS).configJson) as Record<
    string,
    unknown
  >;
  (live as { plugins: { entries: Record<string, unknown> } }).plugins.entries["memory-core"] = { enabled: true };
  const files = generateRuntimePatchedOpenclawFiles(JSON.stringify(live), configWith([TELEGRAM]), "gw-token", RELAY_URLS);
  const patched = JSON.parse(files.configJson) as Rendered;

  assert.equal(patched.channels.whatsapp_cloud, undefined);
  assert.equal(patched.channels.telegram?.botToken, "tg-token");
  assert.equal(patched.tools?.toolsBySender, undefined);
  assert.deepEqual(patched.plugins?.entries?.["agentforall-whatsapp-cloud"], { enabled: true });
  assert.deepEqual(patched.plugins?.entries?.["memory-core"], { enabled: true, config: { dreaming: { enabled: true } } });
});

test("connecting a business number to a live config keeps the tenant's other settings", () => {
  const live = {
    channels: { telegram: { enabled: true, botToken: "tg-token", groups: { "-100": { requireMention: false } } } },
    messages: { custom: true },
  };
  const files = generateRuntimePatchedOpenclawFiles(JSON.stringify(live), configWith([TELEGRAM, CLOUD]), "gw-token", RELAY_URLS);
  const patched = JSON.parse(files.configJson) as Rendered & { messages?: unknown };

  assert.deepEqual(patched.messages, { custom: true });
  assert.deepEqual((patched.channels.telegram?.groups as Record<string, unknown>)["-100"], { requireMention: false });
  assert.equal(patched.channels.whatsapp_cloud?.enabled, true);
});

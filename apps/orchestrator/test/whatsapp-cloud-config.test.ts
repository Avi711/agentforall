import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
} from "../src/services/agent-runtime/openclaw/config.js";
import type { ChannelConfig } from "../src/domain/types.js";
import { configWith, makeWhatsappCloudChannel } from "./helpers/fixtures.js";

interface Rendered {
  channels: Record<string, Record<string, unknown> | undefined>;
  tools?: { exec?: { security: string }; toolsBySender?: Record<string, { deny?: string[]; alsoAllow?: string[] }> };
  plugins?: { entries?: Record<string, unknown> };
  session?: { identityLinks?: Record<string, string[]> };
  commands?: { ownerAllowFrom?: string[] };
}

const TELEGRAM: ChannelConfig = { type: "telegram", botToken: "tg-token", allowFrom: ["tg:123456"] };
const WHATSAPP_OWNED: ChannelConfig = { type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" };
const CLOUD = makeWhatsappCloudChannel();

function render(channels: ChannelConfig[]): { config: Rendered; dotEnv: string } {
  const files = generateOpenclawFiles(configWith(channels), "gw-token");
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
        relayUrl: CLOUD.relayUrl,
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
  const { config } = render([TELEGRAM, WHATSAPP_OWNED, CLOUD]);
  assert.deepEqual(config.plugins?.entries?.["agentforall-whatsapp-cloud"], { enabled: true });
  assert.equal("hooks" in config, false);
  assert.equal(config.tools?.exec?.security, "deny");

  const keys = Object.keys(config.tools?.toolsBySender ?? {});
  assert.deepEqual(keys, ["channel:telegram:123456", "e164:+972501234567", "channel:whatsapp_cloud:+972501234567", "*"]);
  assert.deepEqual(config.tools?.toolsBySender?.["channel:telegram:123456"], {});
  assert.deepEqual(config.tools?.toolsBySender?.["channel:whatsapp_cloud:+972501234567"], {});
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

test("the owner's phone identifies them on the business number too", () => {
  const { config } = render([WHATSAPP_OWNED, CLOUD]);
  assert.deepEqual(config.session?.identityLinks?.owner, [
    "whatsapp:+972501234567",
    "whatsapp_cloud:+972501234567",
  ]);
  assert.deepEqual(config.commands?.ownerAllowFrom, config.session?.identityLinks?.owner);
});

test("a bot without a business number renders none of it", () => {
  const { config, dotEnv } = render([TELEGRAM]);
  assert.equal(config.channels.whatsapp_cloud, undefined);
  assert.equal(config.tools?.toolsBySender, undefined);
  assert.equal(config.plugins?.entries?.["agentforall-whatsapp-cloud"], undefined);
  assert.equal(dotEnv.includes("WHATSAPP_CLOUD"), false);
});

test("disconnecting the business number removes its block, plugin and policy from the live config", () => {
  const live = JSON.parse(generateOpenclawFiles(configWith([TELEGRAM, CLOUD]), "gw-token").configJson) as Record<
    string,
    unknown
  >;
  (live as { plugins: { entries: Record<string, unknown> } }).plugins.entries["memory-core"] = { enabled: true };
  const files = generateRuntimePatchedOpenclawFiles(JSON.stringify(live), configWith([TELEGRAM]), "gw-token");
  const patched = JSON.parse(files.configJson) as Rendered;

  assert.equal(patched.channels.whatsapp_cloud, undefined);
  assert.equal(patched.channels.telegram?.botToken, "tg-token");
  assert.equal(patched.tools?.toolsBySender, undefined);
  assert.equal(patched.plugins?.entries?.["agentforall-whatsapp-cloud"], undefined);
  assert.deepEqual(patched.plugins?.entries?.["memory-core"], { enabled: true, config: { dreaming: { enabled: true } } });
});

test("connecting a business number to a live config keeps the tenant's other settings", () => {
  const live = {
    channels: { telegram: { enabled: true, botToken: "tg-token", groups: { "-100": { requireMention: false } } } },
    messages: { custom: true },
  };
  const files = generateRuntimePatchedOpenclawFiles(JSON.stringify(live), configWith([TELEGRAM, CLOUD]), "gw-token");
  const patched = JSON.parse(files.configJson) as Rendered & { messages?: unknown };

  assert.deepEqual(patched.messages, { custom: true });
  assert.deepEqual((patched.channels.telegram?.groups as Record<string, unknown>)["-100"], { requireMention: false });
  assert.equal(patched.channels.whatsapp_cloud?.enabled, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRuntimePatchedOpenclawFiles } from "../src/services/agent-runtime/openclaw/config.js";
import { configWith } from "./helpers/fixtures.js";
import type { ChannelConfig } from "../src/domain/types.js";

interface Patched {
  channels: Record<string, Record<string, unknown> | undefined>;
  plugins?: { entries?: Record<string, unknown> };
  web?: { reconnect?: { maxMs?: number } };
  browser?: { headless?: boolean };
  logging?: { redactSensitive?: string };
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

// These blocks carry platform hardening; if the on-disk copy wins, an existing tenant can never
// receive it. The WhatsApp reconnect backoff exists to stop a 405 throttle becoming permanent.
test("platform settings reach a container that already has older values", () => {
  const existing = {
    web: { reconnect: { initialMs: 1000, maxMs: 30000, factor: 2, jitter: 0.1, maxAttempts: 3 } },
    browser: { headless: false, noSandbox: false },
    logging: { redactSensitive: "none" },
  };
  const patched = patch(existing, [{ type: "whatsapp" }]);

  assert.equal(patched.web?.reconnect?.maxMs, 600000);
  assert.equal(patched.browser?.headless, true);
  assert.equal(patched.logging?.redactSensitive, "tools");
});

test("the plugin a channel needs is enabled without dropping the runtime's other plugins", () => {
  const existing = { plugins: { entries: { somethingElse: { enabled: true } } } };
  const patched = patch(existing, [{ type: "whatsapp" }]);

  assert.deepEqual(patched.plugins?.entries, {
    somethingElse: { enabled: true },
    whatsapp: { enabled: true },
  });
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

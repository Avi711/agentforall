import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager } from "../src/services/instance-manager.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { ChannelConfig, Instance, InstanceConfig } from "../src/domain/types.js";

test("disconnectWhatsapp logs out, clears creds, keeps the channel and restarts", async () => {
  const h = harness({
    channels: [{ type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" }],
    pairingStatus: "paired",
    hasWhatsappCreds: true,
    whatsappAccountId: "972555555555",
  });

  const after = await h.manager.disconnectWhatsapp(h.instance().id, "user_1");

  assert.deepEqual(h.calls.logout, ["container-1"]);
  assert.deepEqual(h.calls.cancelPairing, []);
  assert.equal(after.pairingStatus, "none");
  assert.equal(after.hasWhatsappCreds, false);
  assert.equal(after.whatsappAccountId, null);
  assert.deepEqual(after.config.channels, [
    { type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" },
  ]);
  // The only restart left on this path; it waits for the start-up window first.
  assert.deepEqual(h.calls.waited, ["container-1"]);
  assert.deepEqual(h.calls.restarted, ["container-1"]);
  assert.ok(h.calls.events.includes("whatsapp.disconnected"));
});

test("disconnectWhatsapp mid-pairing cancels the session instead of logging out", async () => {
  const h = harness({
    channels: [{ type: "whatsapp", dmAccess: "owner" }],
    pairingStatus: "awaiting_qr",
  });

  await h.manager.disconnectWhatsapp(h.instance().id, "user_1");

  assert.deepEqual(h.calls.cancelPairing, ["user_disconnected"]);
  assert.deepEqual(h.calls.logout, []);
  assert.equal(h.instance().pairingStatus, "none");
});

test("disconnectWhatsapp refuses without a channel, while provisioning, or with creds on a stopped container", async () => {
  const none = harness({ channels: [{ type: "telegram", botToken: "t" }] });
  await assert.rejects(() => none.manager.disconnectWhatsapp(none.instance().id, "user_1"), /not found/);

  const provisioning = harness({ channels: [{ type: "whatsapp" }], status: "provisioning" });
  await assert.rejects(
    () => provisioning.manager.disconnectWhatsapp(provisioning.instance().id, "user_1"),
    /provisioning/,
  );

  const stopped = harness({
    channels: [{ type: "whatsapp" }],
    status: "stopped",
    pairingStatus: "paired",
    hasWhatsappCreds: true,
  });
  await assert.rejects(
    () => stopped.manager.disconnectWhatsapp(stopped.instance().id, "user_1"),
    /stopped/,
  );
  assert.equal(stopped.instance().hasWhatsappCreds, true);
});

test("disconnectTelegram revokes the token, strips the channel and reloads the runtime", async () => {
  const h = harness({
    channels: [
      { type: "whatsapp", dmAccess: "owner" },
      { type: "telegram", botToken: "t", botId: 42, allowFrom: ["tg:7"] },
    ],
  });

  const after = await h.manager.disconnectTelegram(h.instance().id, "user_1");

  assert.deepEqual(h.calls.revokedBots, [42]);
  assert.deepEqual(after.config.channels, [{ type: "whatsapp", dmAccess: "owner" }]);
  assert.deepEqual(h.calls.refreshedConfigs, ["container-1"]);
  assert.deepEqual(h.calls.restarted, []);
  assert.ok(h.calls.events.includes("telegram.disconnected"));
});

test("ensureWhatsappChannel adds an owner-only channel once", async () => {
  const h = harness({ channels: [{ type: "telegram", botToken: "t" }] });

  const added = await h.manager.ensureWhatsappChannel(h.instance().id, "user_1");
  assert.deepEqual(added.config.channels, [
    { type: "telegram", botToken: "t" },
    { type: "whatsapp", dmAccess: "owner" },
  ]);
  assert.deepEqual(h.calls.refreshedConfigs, ["container-1"]);
  assert.deepEqual(h.calls.restarted, []);

  const again = await h.manager.ensureWhatsappChannel(h.instance().id, "user_1");
  assert.deepEqual(again.config.channels, added.config.channels);
  assert.deepEqual(h.calls.refreshedConfigs, ["container-1"]);
});

test("updateChannels writes and restarts only when the mutator returns a new array", async () => {
  const h = harness({ channels: [{ type: "whatsapp", dmAccess: "open" }] });
  const same = await h.manager.updateChannels(h.instance().id, "user_1", (channels) => channels);
  assert.equal(same.changed, false);
  assert.deepEqual(h.calls.restarted, []);
  assert.deepEqual(h.calls.refreshedConfigs, []);

  const changed = await h.manager.updateChannels(h.instance().id, "user_1", (channels) => [
    ...channels,
    { type: "telegram" },
  ]);
  assert.equal(changed.changed, true);
  assert.equal(changed.instance.config.channels.length, 2);
  assert.deepEqual(h.calls.refreshedConfigs, ["container-1"]);
  // A hot-reloading runtime applies the file itself: no restart, no outage.
  assert.deepEqual(h.calls.restarted, []);
});

test("config writes restart only runtimes that cannot hot-reload, and only after start-up settles", async () => {
  const h = harness({ channels: [{ type: "whatsapp", dmAccess: "open" }], hotReload: false });
  await h.manager.updateChannels(h.instance().id, "user_1", (channels) => [...channels, { type: "telegram" }]);
  assert.deepEqual(h.calls.refreshedConfigs, ["container-1"]);
  assert.deepEqual(h.calls.waited, ["container-1"]);
  assert.deepEqual(h.calls.restarted, ["container-1"]);
});

test("disconnectWhatsapp keeps creds when the session could not be cleared", async () => {
  const h = harness({
    channels: [{ type: "whatsapp", dmAccess: "open" }],
    pairingStatus: "paired",
    hasWhatsappCreds: true,
    logoutCleared: false,
  });
  await assert.rejects(
    () => h.manager.disconnectWhatsapp(h.instance().id, "user_1"),
    /whatsapp logout unavailable/,
  );
  assert.equal(h.instance().hasWhatsappCreds, true);
  assert.equal(h.instance().pairingStatus, "paired");
  assert.deepEqual(h.calls.restarted, []);
  assert.ok(!h.calls.events.includes("whatsapp.disconnected"));
});

interface Overrides {
  channels: ChannelConfig[];
  status?: Instance["status"];
  pairingStatus?: Instance["pairingStatus"];
  hasWhatsappCreds?: boolean;
  whatsappAccountId?: string | null;
  logoutCleared?: boolean;
  hotReload?: boolean;
  refreshConfigError?: Error;
  containerRunning?: boolean;
  applyOutcome?: "applied" | "restart_required";
}

// The row must never claim a config the container refused, or the dashboard shows a bot that
// does not exist.
test("a config the container refused is not persisted", async () => {
  const h = harness({
    channels: [{ type: "whatsapp" }],
    refreshConfigError: new Error("openclaw rejected the config: must be boolean"),
  });

  await assert.rejects(
    h.manager.updateConfig(h.instance().id, h.instance().userId, {
      channels: [{ type: "whatsapp" }, { type: "telegram", botToken: "t" }],
    }),
    /must be boolean/,
  );
  assert.deepEqual(h.instance().config.channels, [{ type: "whatsapp" }]);
});

// A row can say "error" while the container is happily serving; a staged change still has to be
// made live, or it is the silent-failure shape all over again.
test("a staged change restarts a container that is actually running, whatever the row says", async () => {
  const h = harness({
    channels: [{ type: "whatsapp" }],
    status: "error",
    applyOutcome: "restart_required",
    containerRunning: true,
  });

  await h.manager.updateConfig(h.instance().id, h.instance().userId, {
    channels: [{ type: "whatsapp" }, { type: "telegram", botToken: "t" }],
  });

  assert.deepEqual(h.calls.restarted, ["container-1"]);
});

test("a staged change does not restart a container that is not running", async () => {
  const h = harness({
    channels: [{ type: "whatsapp" }],
    status: "stopped",
    applyOutcome: "restart_required",
    containerRunning: false,
  });

  await h.manager.updateConfig(h.instance().id, h.instance().userId, {
    channels: [{ type: "whatsapp" }, { type: "telegram", botToken: "t" }],
  });

  assert.deepEqual(h.calls.restarted, []);
});

// The split is the whole design: a caller that restarts anyway must never pay for the live RPC,
// and a live change must never be silently staged instead of applied.
test("only a live config change uses the gateway; restart and start stage a file", async () => {
  const live = harness({ channels: [{ type: "whatsapp" }] });
  await live.manager.updateConfig(live.instance().id, live.instance().userId, {
    channels: [{ type: "whatsapp" }, { type: "telegram", botToken: "t" }],
  });
  assert.deepEqual(live.calls.appliedLive, ["container-1"]);
  assert.deepEqual(live.calls.staged, []);

  const restarted = harness({ channels: [{ type: "whatsapp" }] });
  await restarted.manager.restart(restarted.instance().id, restarted.instance().userId);
  assert.deepEqual(restarted.calls.staged, ["container-1"]);
  assert.deepEqual(restarted.calls.appliedLive, []);
});

// Container limits are set when the container is created, so accepting a change here would report
// success for something the running container can never pick up.
test("a resources change is refused instead of being reported as applied", async () => {
  const h = harness({ channels: [{ type: "whatsapp" }] });

  await assert.rejects(
    h.manager.updateConfig(h.instance().id, h.instance().userId, {
      resources: { memoryMb: 8192 },
    }),
    /recreate/i,
  );
  assert.deepEqual(h.calls.appliedLive, []);
  assert.equal(h.instance().config.resources.memoryMb, 4096);
});

test("an unchanged resources block is not mistaken for a change", async () => {
  const h = harness({ channels: [{ type: "whatsapp" }] });

  await h.manager.updateConfig(h.instance().id, h.instance().userId, {
    resources: { memoryMb: 4096, cpuShares: 512 },
  });

  assert.deepEqual(h.calls.appliedLive, ["container-1"]);
});

function harness(overrides: Overrides) {
  let instance = makeInstance(overrides);
  const calls = {
    logout: [] as string[],
    cancelPairing: [] as string[],
    waited: [] as string[],
    restarted: [] as string[],
    refreshedConfigs: [] as string[],
    staged: [] as string[],
    appliedLive: [] as string[],
    revokedBots: [] as number[],
    events: [] as string[],
  };

  const repo = {
    findById: async (id: string) => (id === instance.id ? instance : null),
    updatePairing: async (
      _id: string,
      patch: { pairingStatus?: Instance["pairingStatus"]; whatsappCreds?: Buffer | null; whatsappAccountId?: string | null },
    ) => {
      instance = {
        ...instance,
        ...(patch.pairingStatus !== undefined ? { pairingStatus: patch.pairingStatus } : {}),
        ...(patch.whatsappCreds !== undefined ? { hasWhatsappCreds: patch.whatsappCreds !== null } : {}),
        ...(patch.whatsappAccountId !== undefined ? { whatsappAccountId: patch.whatsappAccountId } : {}),
      };
      return true;
    },
    updateStatus: async () => true,
    updateConfig: async (_id: string, config: InstanceConfig) => {
      instance = { ...instance, config };
    },
  };
  const runtime = {
    isRunning: async () => overrides.containerRunning ?? true,
    waitForHealthy: async (containerId: string) => {
      calls.waited.push(containerId);
      return true;
    },
    restart: async (containerId: string) => {
      calls.restarted.push(containerId);
    },
  };
  const registry = {
    get: () => ({
      hotReloadsConfig: overrides.hotReload ?? true,
      writeConfig: async (containerId: string) => {
        calls.refreshedConfigs.push(containerId);
        calls.staged.push(containerId);
      },
      applyConfig: async (containerId: string) => {
        if (overrides.refreshConfigError) throw overrides.refreshConfigError;
        calls.refreshedConfigs.push(containerId);
        calls.appliedLive.push(containerId);
        return overrides.applyOutcome ?? ((overrides.hotReload ?? true) ? "applied" : "restart_required");
      },
    }),
  } as unknown as AgentRuntimeRegistry;
  const pairingManager = {
    logoutWhatsapp: async (_id: string, containerId: string) => {
      calls.logout.push(containerId);
      return overrides.logoutCleared ?? true;
    },
    cancelPairing: async (_id: string, reason: string) => {
      calls.cancelPairing.push(reason);
      instance = { ...instance, pairingStatus: "failed" };
    },
  };
  const telegramApi = {
    replaceManagedBotToken: async (botId: number) => {
      calls.revokedBots.push(botId);
      return "new-token";
    },
  };

  const manager = new InstanceManager(
    repo as never,
    runtime as unknown as ContainerRuntime,
    registry,
    {} as never,
    {} as AppConfig,
    { append: async (_id: string, type: string) => { calls.events.push(type); } } as never,
    pairingManager as never,
    { revoke: async () => {}, revokeKey: async () => {} } as never,
    { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger,
    null,
    undefined,
    telegramApi as never,
  );

  return { manager, calls, instance: () => instance };
}

function makeInstance(overrides: Overrides): Instance {
  return {
    id: "4b86fc8b-ef19-496b-9591-583c72069443",
    userId: "user_1",
    hostId: "local-dev",
    runtimeKind: "openclaw",
    displayName: "Bot",
    status: overrides.status ?? "running",
    config: {
      displayName: "Bot",
      provider: { name: "openai", apiKey: "k", model: "gpt-5" },
      channels: overrides.channels,
      resources: { memoryMb: 4096, cpuShares: 512 },
    },
    containerId: "container-1",
    containerName: "openclaw-4b86fc8b-ef1",
    gatewayPort: 19000,
    gatewayToken: "gateway-token",
    healthFailures: 0,
    errorMessage: null,
    pairingStatus: overrides.pairingStatus ?? "none",
    whatsappAccountId: overrides.whatsappAccountId ?? null,
    hasWhatsappCreds: overrides.hasWhatsappCreds ?? false,
    lastSeenAt: null,
    backupImport: { status: "none", objectName: null, contentLength: null, contentType: null },
    litellm: { keyAlias: null, keyHash: null, budgetCents: null, budgetDuration: null },
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    stoppedAt: null,
    destroyedAt: null,
  };
}

test("channel patches keep the relay binding; an explicit null clears it", async () => {
  const h = harness({ channels: [{ type: "whatsapp" }] });
  const { id, userId } = h.instance();
  const binding = { relayToken: "t", relayUrl: "http://orchestrator:3000/api/v1/mcp/x" };

  await h.manager.updateConfig(id, userId, { integrations: binding });
  await h.manager.updateConfig(id, userId, { channels: [{ type: "whatsapp", dmAccess: "owner" }] });
  assert.deepEqual(h.instance().config.integrations, binding);

  await h.manager.updateConfig(id, userId, { integrations: null });
  assert.equal("integrations" in h.instance().config, false);
});

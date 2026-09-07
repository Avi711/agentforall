import { test } from "node:test";
import assert from "node:assert/strict";
import { PairingManager } from "../src/services/pairing-manager.js";
import type { InstanceRepository } from "../src/storage/instance-repository.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { EventRepository } from "../src/storage/event-repository.js";
import type { Instance, PairingStatus } from "../src/domain/types.js";
import type { PairingConfig } from "../src/config.js";
import { PairingSessionRegistry } from "../src/services/pairing-session-registry.js";
import { PairingSidecarClient } from "../src/services/pairing-sidecar-client.js";
import { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";

test("startPairing serializes concurrent calls for the same instance", async () => {
  let pairingStatus: PairingStatus = "none";
  let sidecarCreates = 0;

  const repo = {
    updatePairing: async (
      _id: string,
      patch: { pairingStatus?: PairingStatus },
      options?: { expectedPairingStatus?: PairingStatus | PairingStatus[] },
    ) => {
      await sleep(10);
      const expected = options?.expectedPairingStatus;
      const allowed = Array.isArray(expected) ? expected : expected ? [expected] : null;
      if (allowed && !allowed.includes(pairingStatus)) return false;
      if (patch.pairingStatus) pairingStatus = patch.pairingStatus;
      return true;
    },
  } as unknown as InstanceRepository;

  const runtime = {
    isRunning: async () => sidecarCreates > 0,
    removeIfExists: async () => undefined,
    createSidecar: async () => {
      sidecarCreates += 1;
      await sleep(20);
      return `sidecar-${sidecarCreates}`;
    },
    start: async () => undefined,
    getPublishedHostPort: async () => null,
  } as unknown as ContainerRuntime;

  const eventLog = {
    append: async () => undefined,
  } as unknown as EventRepository;

  const manager = createPairingManager(
    repo,
    runtime,
    eventLog,
  );

  const [first, second] = await Promise.all([
    manager.startPairing(instance),
    manager.startPairing(instance),
  ]);

  assert.equal(sidecarCreates, 1);
  assert.deepEqual(
    [first.status, second.status].sort(),
    ["already_active", "started"],
  );
});

test("startPairing still rejects healthy paired instances", async () => {
  const manager = createPairingManager(
    {} as InstanceRepository,
    {} as ContainerRuntime,
    {} as EventRepository,
  );

  await assert.rejects(
    () =>
      manager.startPairing({
        ...instance,
        pairingStatus: "paired",
        hasWhatsappCreds: true,
        whatsappAccountId: "972555555555",
      }),
    /cannot transition from 'paired' to 'pair'/,
  );
});

test("cancelPairing only marks active pairings as failed", async () => {
  let pairingStatus: PairingStatus = "paired";
  let appendCount = 0;
  let teardownCount = 0;

  const repo = {
    updatePairing: async (
      _id: string,
      patch: { pairingStatus?: PairingStatus },
      options?: { expectedPairingStatus?: PairingStatus | PairingStatus[] },
    ) => {
      const expected = options?.expectedPairingStatus;
      const allowed = Array.isArray(expected) ? expected : expected ? [expected] : null;
      if (allowed && !allowed.includes(pairingStatus)) return false;
      if (patch.pairingStatus) pairingStatus = patch.pairingStatus;
      return true;
    },
  } as unknown as InstanceRepository;

  const runtime = {
    findContainerByName: async () => {
      teardownCount += 1;
      return null;
    },
  } as unknown as ContainerRuntime;

  const eventLog = {
    append: async () => {
      appendCount += 1;
    },
  } as unknown as EventRepository;

  const manager = createPairingManager(
    repo,
    runtime,
    eventLog,
  );

  await manager.cancelPairing(instance.id, "user_cancelled");

  assert.equal(pairingStatus, "paired");
  assert.equal(appendCount, 0);
  assert.equal(teardownCount, 0);
});

test("expireStale only tears down when the stale-state CAS wins", async () => {
  let appendCount = 0;
  let teardownCount = 0;

  const repo = {
    findStalePairings: async () => [
      { ...instance, pairingStatus: "awaiting_qr" as const },
    ],
    updatePairing: async () => false,
  } as unknown as InstanceRepository;

  const runtime = {
    findContainerByName: async () => {
      teardownCount += 1;
      return null;
    },
  } as unknown as ContainerRuntime;

  const eventLog = {
    append: async () => {
      appendCount += 1;
    },
  } as unknown as EventRepository;

  const manager = createPairingManager(
    repo,
    runtime,
    eventLog,
  );

  await manager.expireStale(1);

  assert.equal(appendCount, 0);
  assert.equal(teardownCount, 0);
});

test("validateAuthToken rejects malformed fixed-length tokens without throwing", () => {
  const manager = createPairingManager(
    {} as InstanceRepository,
    {} as ContainerRuntime,
    {} as EventRepository,
  );

  assert.equal(manager.validateAuthToken(instance.id, "א".repeat(64)), false);
  assert.equal(manager.validateAuthToken(instance.id, "z".repeat(64)), false);
});

const instance: Instance = {
  id: "4b86fc8b-ef19-496b-9591-583c72069443",
  userId: "user_1",
  hostId: "local-dev",
  runtimeKind: "openclaw",
  displayName: "Agent",
  status: "running",
  config: {
    displayName: "Agent",
    provider: { name: "openai", apiKey: "key", model: "gpt-5" },
    channels: [{ type: "whatsapp" }],
    resources: { memoryMb: 512, cpuShares: 256 },
  },
  containerId: "container-1",
  containerName: "openclaw-4b86fc8b",
  gatewayPort: 19000,
  gatewayToken: "token",
  healthFailures: 0,
  errorMessage: null,
  pairingStatus: "none",
  whatsappAccountId: null,
  hasWhatsappCreds: false,
  lastSeenAt: null,
  backupImport: {
    status: "none",
    objectName: null,
    contentLength: null,
    contentType: null,
  },
  litellm: {
    keyAlias: null,
    keyHash: null,
    budgetCents: null,
    budgetDuration: null,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  stoppedAt: null,
  destroyedAt: null,
};

const pairingConfig: PairingConfig = {
  image: "pairing",
  port: 18790,
  idleTimeoutMs: 60_000,
  requestTimeoutMs: 1_000,
  staleThresholdMs: 60_000,
  logLevel: "silent",
  orchestratorInternalUrl: "http://orchestrator:3000",
  publishSidecarPort: false,
  useDockerNetwork: false,
};

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

function createPairingManager(
  repo: InstanceRepository,
  runtime: ContainerRuntime,
  eventLog: EventRepository,
  adapter?: AgentRuntimeAdapter,
): PairingManager {
  const sessions = new PairingSessionRegistry();
  const sidecarClient = new PairingSidecarClient(
    sessions,
    pairingConfig,
    logger,
  );
  return new PairingManager(
    repo,
    runtime,
    new AgentRuntimeRegistry(adapter ? [adapter] : []),
    eventLog,
    pairingConfig,
    logger,
    sessions,
    sidecarClient,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ActivationHarness {
  calls: string[];
  events: string[];
  restarts: number;
  manager: PairingManager;
}

function activationHarness(opts: {
  startStatus?: "started" | "unavailable";
  linkStates?: ("connected" | "disconnected")[];
  sendOk?: boolean;
}): ActivationHarness {
  const calls: string[] = [];
  const events: string[] = [];
  const states = [...(opts.linkStates ?? ["connected"])];
  const harness: ActivationHarness = { calls, events, restarts: 0, manager: undefined as never };

  const adapter = {
    kind: "openclaw",
    injectWhatsappSession: async () => {
      calls.push("inject");
    },
    startWhatsappChannel: async () => {
      calls.push("start");
      return opts.startStatus === "unavailable"
        ? { status: "unavailable" as const, reason: "no gateway" }
        : { status: "started" as const };
    },
    probeWhatsapp: async () => {
      calls.push("probe");
      return states.length > 1 ? states.shift()! : states[0];
    },
    writeConfig: async () => {
      calls.push("writeConfig");
    },
    sendWhatsappMessage: async (_c: string, to: string) => {
      calls.push(`hello:${to}`);
      return opts.sendOk ?? true;
    },
  } as unknown as AgentRuntimeAdapter;

  const repo = {
    updatePairing: async () => true,
    findById: async () => instance,
  } as unknown as InstanceRepository;

  const runtime = {
    restart: async () => {
      harness.restarts += 1;
      calls.push("restart");
    },
    findContainerByName: async () => null,
    remove: async () => undefined,
  } as unknown as ContainerRuntime;

  const eventLog = {
    append: async (_id: string, type: string) => {
      events.push(type);
    },
    recent: async () => events.map((eventType) => ({ eventType })).reverse(),
  } as unknown as EventRepository;

  harness.manager = createPairingManager(repo, runtime, eventLog, adapter);
  return harness;
}

const ownedInstance: Instance = {
  ...instance,
  config: {
    ...instance.config,
    channels: [{ type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" }],
  },
};

async function settle(harness: ActivationHarness): Promise<void> {
  for (let i = 0; i < 200 && !harness.events.includes("pair.ready"); i++) await sleep(10);
}

test("completePairing links in place and the bot says hello, without a container restart", async () => {
  const h = activationHarness({});
  await h.manager.completePairing(ownedInstance, Buffer.from("creds"), "972552506938");
  await settle(h);

  assert.deepEqual(h.calls, ["inject", "start", "probe", "hello:+972501234567"]);
  assert.equal(h.restarts, 0);
  assert.deepEqual(h.events, ["pair.authenticated", "pair.ready"]);
  assert.equal(await h.manager.isReady(ownedInstance.id), true);
});

test("completePairing falls back to a restart when the channel cannot be started in place", async () => {
  const h = activationHarness({ startStatus: "unavailable" });
  await h.manager.completePairing(ownedInstance, Buffer.from("creds"), null);
  await settle(h);

  assert.deepEqual(h.calls, ["inject", "start", "writeConfig", "restart", "probe", "hello:+972501234567"]);
  assert.equal(h.restarts, 1);
  assert.ok(h.events.includes("pair.restart_fallback"));
});

test("completePairing skips the hello when no owner number is known", async () => {
  const h = activationHarness({});
  await h.manager.completePairing(instance, Buffer.from("creds"), null);
  await settle(h);

  assert.ok(!h.calls.some((c) => c.startsWith("hello:")));
  assert.equal(await h.manager.isReady(instance.id), true);
});

test("isReady is false between a fresh link and its activation", async () => {
  const events = ["pair.ready", "pair.authenticated"];
  const eventLog = {
    append: async () => undefined,
    recent: async () => events.map((eventType) => ({ eventType })).reverse(),
  } as unknown as EventRepository;
  const manager = createPairingManager({} as InstanceRepository, {} as ContainerRuntime, eventLog);
  assert.equal(await manager.isReady(instance.id), false);
});

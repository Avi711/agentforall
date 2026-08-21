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
    new AgentRuntimeRegistry([]),
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

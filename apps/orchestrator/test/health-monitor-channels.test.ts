import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthMonitor } from "../src/services/health-monitor.js";
import type { Instance } from "../src/domain/types.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type {
  AgentRuntimeAdapter,
  GatewayLiveness,
  WhatsappLinkState,
} from "../src/services/agent-runtime/types.js";

const CHANNEL_INTERVAL_MS = 60_000;

interface HealthUpdate {
  id: string;
  failures: number;
  status: string;
}

class FakeRepo {
  readonly healthUpdates: HealthUpdate[] = [];
  readonly pairingUpdates: { id: string; patch: unknown }[] = [];

  constructor(private instances: Instance[]) {}

  setInstances(instances: Instance[]): void {
    this.instances = instances;
  }

  async findByStatuses(): Promise<Instance[]> {
    return this.instances;
  }

  async updateHealth(id: string, failures: number, status: string): Promise<void> {
    this.healthUpdates.push({ id, failures, status });
  }

  async updatePairing(id: string, patch: unknown): Promise<void> {
    this.pairingUpdates.push({ id, patch });
  }

  async updateContainerId(): Promise<void> {}
}

const runtime = {
  inspect: async () => ({ State: { Running: true } }),
  findContainerByName: async () => "container-1",
} as unknown as ContainerRuntime;

function createLogger() {
  const warnings: string[] = [];
  const infos: string[] = [];
  const logger = {
    info: (_ctx: unknown, msg?: string) => {
      if (msg) infos.push(msg);
    },
    warn: (_ctx: unknown, msg?: string) => {
      if (msg) warnings.push(msg);
    },
    error: () => {},
  } as never;
  return { logger, warnings, infos };
}

const silentLogger = createLogger().logger;

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "instance-1",
    containerId: "container-1",
    containerName: "openclaw-instance-1",
    runtimeKind: "openclaw",
    hasWhatsappCreds: true,
    pairingStatus: "paired",
    status: "running",
    healthFailures: 0,
    config: { channels: [{ type: "whatsapp" }] },
    ...overrides,
  } as unknown as Instance;
}

function createMonitor(
  repo: FakeRepo,
  probes: {
    gateway?: () => Promise<GatewayLiveness>;
    whatsapp: () => Promise<WhatsappLinkState>;
  },
  clock: { now: number },
  logger: unknown = silentLogger,
) {
  let whatsappCalls = 0;
  const adapter = {
    kind: "openclaw",
    probeGateway: probes.gateway ?? (async () => ({ healthy: true, degraded: null })),
    probeWhatsapp: async () => {
      whatsappCalls += 1;
      return probes.whatsapp();
    },
  } as unknown as AgentRuntimeAdapter;

  const monitor = new HealthMonitor(
    repo as never,
    runtime,
    { get: () => adapter } as unknown as AgentRuntimeRegistry,
    logger as never,
    {
      pollIntervalMs: 15_000,
      channelPollIntervalMs: CHANNEL_INTERVAL_MS,
      channelStateMaxAgeMs: 600_000,
      channelProbeMaxBackoffMs: 900_000,
      degradedThreshold: 5,
      unhealthyThreshold: 10,
      requestTimeoutMs: 10_000,
      channelProbeTimeoutMs: 10_000,
      useDockerNetwork: true,
      maxConcurrentChecks: 4,
    },
    () => clock.now,
  );

  return { monitor, whatsappCalls: () => whatsappCalls };
}

test("a probe that cannot answer never marks a live instance unhealthy", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor } = createMonitor(repo, { whatsapp: async () => "probe_failed" }, clock);

  await monitor.pollAll();

  assert.deepEqual(repo.healthUpdates, [
    { id: "instance-1", failures: 0, status: "running" },
  ]);
  assert.deepEqual(repo.pairingUpdates, []);
});

test("output that breaks the contract also leaves the instance healthy", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor } = createMonitor(repo, { whatsapp: async () => "protocol_error" }, clock);

  await monitor.pollAll();

  assert.equal(repo.healthUpdates[0]?.status, "running");
});

test("a definite disconnect still degrades the instance and expires pairing", async () => {
  const repo = new FakeRepo([makeInstance({ healthFailures: 9 })]);
  const clock = { now: 1_000 };
  const { monitor } = createMonitor(repo, { whatsapp: async () => "disconnected" }, clock);

  await monitor.pollAll();

  assert.deepEqual(repo.healthUpdates, [
    { id: "instance-1", failures: 10, status: "unhealthy" },
  ]);
  assert.deepEqual(repo.pairingUpdates, [
    {
      id: "instance-1",
      patch: { pairingStatus: "expired", whatsappAccountId: null },
    },
  ]);
});

test("channel state is reused between polls instead of re-probed every tick", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    { whatsapp: async () => "connected" },
    clock,
  );

  await monitor.pollAll();
  clock.now += 15_000;
  await monitor.pollAll();
  clock.now += 15_000;
  await monitor.pollAll();
  assert.equal(whatsappCalls(), 1, "cached within the channel interval");

  clock.now += CHANNEL_INTERVAL_MS;
  await monitor.pollAll();
  assert.equal(whatsappCalls(), 2, "re-probed once the interval elapses");
});

test("repeated probe failures back off and stop hammering a wedged gateway", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    { whatsapp: async () => "probe_failed" },
    clock,
  );

  await monitor.pollAll();
  assert.equal(whatsappCalls(), 1);

  // First backoff is one channel interval; polling before it elapses must not probe.
  clock.now += CHANNEL_INTERVAL_MS - 1;
  await monitor.pollAll();
  assert.equal(whatsappCalls(), 1);

  clock.now += 1;
  await monitor.pollAll();
  assert.equal(whatsappCalls(), 2);

  // Second failure doubles the wait, so one interval is no longer enough.
  clock.now += CHANNEL_INTERVAL_MS;
  await monitor.pollAll();
  assert.equal(whatsappCalls(), 2);

  clock.now += CHANNEL_INTERVAL_MS;
  await monitor.pollAll();
  assert.equal(whatsappCalls(), 3);
});

test("backoff is capped so a wedged instance is still retried", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    { whatsapp: async () => "probe_failed" },
    clock,
  );

  for (let i = 0; i < 20; i++) {
    clock.now += 900_000;
    await monitor.pollAll();
  }

  assert.ok(whatsappCalls() >= 20, `expected retries to continue, got ${whatsappCalls()}`);
});

test("a connected answer nobody has reconfirmed stops counting as evidence", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  let state: WhatsappLinkState = "connected";
  const { monitor } = createMonitor(repo, { whatsapp: async () => state }, clock);

  await monitor.pollAll();
  state = "probe_failed";

  // Well past channelStateMaxAgeMs: the stale "connected" must decay to unknown rather than
  // being reported forever, but unknown still must not mark the instance unhealthy.
  clock.now += 10_000_000;
  await monitor.pollAll();

  assert.ok(repo.healthUpdates.every((u) => u.status === "running"));
});

test("a dead gateway short-circuits before any channel probe runs", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    {
      gateway: async () => ({ healthy: false, degraded: null }),
      whatsapp: async () => "connected",
    },
    clock,
  );

  await monitor.pollAll();

  assert.equal(whatsappCalls(), 0);
  assert.deepEqual(repo.healthUpdates, [
    { id: "instance-1", failures: 1, status: "running" },
  ]);
});

test("channel state for instances that left the active set is dropped", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const clock = { now: 1_000 };
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    { whatsapp: async () => "connected" },
    clock,
  );

  await monitor.pollAll();
  assert.equal(whatsappCalls(), 1);

  repo.setInstances([]);
  await monitor.pollAll();

  repo.setInstances([makeInstance()]);
  await monitor.pollAll();
  // Cache was pruned, so the instance is probed again rather than trusting a dropped entry.
  assert.equal(whatsappCalls(), 2);
});

test("instances without whatsapp credentials are never channel-probed", async () => {
  const repo = new FakeRepo([makeInstance({ hasWhatsappCreds: false })]);
  const clock = { now: 1_000 };
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    { whatsapp: async () => "connected" },
    clock,
  );

  await monitor.pollAll();

  assert.equal(whatsappCalls(), 0);
  assert.equal(repo.healthUpdates[0]?.status, "running");
});

test("readiness is logged on transition, not on every poll", async () => {
  const repo = new FakeRepo([makeInstance({ hasWhatsappCreds: false })]);
  const clock = { now: 1_000 };
  const { logger, warnings, infos } = createLogger();
  let degraded = true;
  const { monitor } = createMonitor(
    repo,
    {
      gateway: async () => ({ healthy: true, degraded }),
      whatsapp: async () => "connected",
    },
    clock,
    logger,
  );

  for (let i = 0; i < 4; i++) {
    clock.now += 15_000;
    await monitor.pollAll();
  }
  assert.equal(
    warnings.filter((m) => m === "gateway live but not ready").length,
    1,
    "unready gateway must warn once, not every poll",
  );

  degraded = false;
  await monitor.pollAll();
  await monitor.pollAll();
  assert.equal(infos.filter((m) => m === "gateway ready again").length, 1);
});

test("a runtime with no readiness signal never logs readiness at all", async () => {
  const repo = new FakeRepo([makeInstance({ hasWhatsappCreds: false })]);
  const clock = { now: 1_000 };
  const { logger, warnings, infos } = createLogger();
  const { monitor } = createMonitor(
    repo,
    {
      gateway: async () => ({ healthy: true, degraded: null }),
      whatsapp: async () => "connected",
    },
    clock,
    logger,
  );

  await monitor.pollAll();
  await monitor.pollAll();

  assert.equal(warnings.filter((m) => m.includes("ready")).length, 0);
  assert.equal(infos.filter((m) => m.includes("ready")).length, 0);
});

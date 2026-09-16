import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HealthMonitor,
  type LivenessObserver,
  type LivenessReport,
  type LivenessSample,
} from "../src/services/health-monitor.js";
import type { Instance } from "../src/domain/types.js";
import type { ContainerRuntime, ContainerState } from "../src/services/container-runtime.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { HostRuntime, HostRuntimes } from "../src/services/host-runtimes.js";
import { singleHost } from "./helpers/host-runtimes.js";
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
  readonly containerIdUpdates: { id: string; containerId: string }[] = [];

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

  async updateContainerId(id: string, containerId: string): Promise<void> {
    this.containerIdUpdates.push({ id, containerId });
  }
}

const SETTLED: ContainerState = { running: true, restarting: false, health: "healthy", startedAt: null };

function fakeRuntime(
  state: ContainerState | null = SETTLED,
  options: { byName?: string | null; throws?: boolean } = {},
) {
  return {
    containerState: async () => {
      if (options.throws) throw new Error("docker unreachable");
      return state;
    },
    findContainerByName: async () => (options.byName === undefined ? "container-1" : options.byName),
  } as unknown as ContainerRuntime;
}

const runtime = fakeRuntime();

class RecordingObserver implements LivenessObserver {
  readonly reports: { id: string; sample: LivenessSample }[][] = [];

  observe(report: readonly LivenessReport[]): void {
    this.reports.push(report.map((entry) => ({ id: entry.instance.id, sample: entry.sample })));
  }

  get samples(): { id: string; sample: LivenessSample }[] {
    return this.reports.flat();
  }
}

function createLogger() {
  const warnings: string[] = [];
  const infos: string[] = [];
  const logger = {
    info: (_ctx: unknown, msg?: string) => {
      if (msg) infos.push(msg);
    },
    warn: (_ctx: unknown, msg?: string) => {
      if (typeof _ctx === "string") warnings.push(_ctx);
      else if (msg) warnings.push(msg);
    },
    error: () => {},
  } as never;
  return { logger, warnings, infos };
}

const silentLogger = createLogger().logger;

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "instance-1",
    hostId: "test-host",
    containerId: "container-1",
    containerName: "openclaw-instance-1",
    runtimeKind: "openclaw",
    hasWhatsappCreds: true,
    pairingStatus: "paired",
    status: "running",
    healthFailures: 0,
    lastSeenAt: null,
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
  options: { observer?: LivenessObserver; runtime?: ContainerRuntime; reachable?: () => boolean } = {},
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
    singleHost(
      options.runtime ?? runtime,
      { get: () => adapter } as unknown as AgentRuntimeRegistry,
      { check: async () => options.reachable?.() ?? true },
    ),
    logger as never,
    MONITOR_CONFIG,
    () => clock.now,
    options.observer ?? null,
  );

  return { monitor, whatsappCalls: () => whatsappCalls };
}

const MONITOR_CONFIG = {
  pollIntervalMs: 15_000,
  channelPollIntervalMs: CHANNEL_INTERVAL_MS,
  channelStateMaxAgeMs: 600_000,
  channelProbeMaxBackoffMs: 900_000,
  degradedThreshold: 5,
  unhealthyThreshold: 10,
  requestTimeoutMs: 10_000,
  channelProbeTimeoutMs: 10_000,
  maxConcurrentChecks: 4,
};

test("a healthy row seen less than a minute ago is not rewritten; stale, degraded or recovering rows are", async () => {
  const clock = { now: 10_000_000 };
  const cases: { inst: Instance; writes: number; why: string }[] = [
    { inst: makeInstance({ lastSeenAt: new Date(clock.now - 30_000) }), writes: 0, why: "fresh" },
    { inst: makeInstance({ lastSeenAt: new Date(clock.now - 60_000) }), writes: 1, why: "stale" },
    { inst: makeInstance({ lastSeenAt: null }), writes: 1, why: "never seen" },
    { inst: makeInstance({ status: "degraded", lastSeenAt: new Date(clock.now) }), writes: 1, why: "degraded" },
    { inst: makeInstance({ healthFailures: 2, lastSeenAt: new Date(clock.now) }), writes: 1, why: "recovering" },
  ];
  for (const c of cases) {
    const repo = new FakeRepo([c.inst]);
    const { monitor } = createMonitor(repo, { whatsapp: async () => "connected" }, clock);
    await monitor.pollAll();
    assert.equal(repo.healthUpdates.length, c.writes, c.why);
  }
});

function countingRuntime() {
  const calls = { state: 0, byName: 0 };
  const rt = {
    containerState: async () => {
      calls.state += 1;
      return SETTLED;
    },
    findContainerByName: async () => {
      calls.byName += 1;
      return "container-1";
    },
  } as unknown as ContainerRuntime;
  return { rt, calls };
}

test("a healthy bot seen within the minute is probed without any Docker call", async () => {
  const clock = { now: 10_000_000 };
  const { rt, calls } = countingRuntime();
  const repo = new FakeRepo([makeInstance({ hasWhatsappCreds: false, lastSeenAt: new Date(clock.now - 10_000) })]);
  const { monitor } = createMonitor(repo, { whatsapp: async () => "connected" }, clock, silentLogger, { runtime: rt });

  await monitor.pollAll();

  assert.deepEqual(calls, { state: 0, byName: 0 });
  assert.deepEqual(repo.healthUpdates, []);
});

test("the minute tick repairs a row whose container id lags, and writes are spaced a minute apart", async () => {
  const clock = { now: 10_000_000 };
  const { rt, calls } = countingRuntime();
  const inst = makeInstance({ hasWhatsappCreds: false, containerId: null, lastSeenAt: null });
  const repo = new FakeRepo([inst]);
  const { monitor } = createMonitor(repo, { whatsapp: async () => "connected" }, clock, silentLogger, { runtime: rt });

  await monitor.pollAll();
  assert.deepEqual(repo.containerIdUpdates, [{ id: "instance-1", containerId: "container-1" }]);
  assert.equal(calls.byName, 1);
  assert.equal(repo.healthUpdates.length, 1);

  // Mimic the row after the write: seen now, id repaired.
  repo.setInstances([makeInstance({ hasWhatsappCreds: false, lastSeenAt: new Date(clock.now) })]);
  clock.now += 15_000;
  await monitor.pollAll();
  clock.now += 15_000;
  await monitor.pollAll();
  assert.equal(repo.healthUpdates.length, 1, "no writes inside the minute");

  clock.now += 30_000;
  await monitor.pollAll();
  assert.equal(repo.healthUpdates.length, 2, "written again once the minute is up");
});

test("a failed probe on a stopped container does not rewrite the same container id", async () => {
  const repo = new FakeRepo([makeInstance({ hasWhatsappCreds: false })]);
  const observer = new RecordingObserver();
  const { monitor } = createMonitor(
    repo,
    { gateway: async () => ({ healthy: false, degraded: null }), whatsapp: async () => "connected" },
    { now: 1_000 },
    silentLogger,
    { observer, runtime: fakeRuntime({ ...SETTLED, running: false }) },
  );

  await monitor.pollAll();

  assert.deepEqual(observer.samples, [{ id: "instance-1", sample: "unknown" }]);
  assert.deepEqual(repo.containerIdUpdates, []);
});

test("stop waits for the poll in flight and a second poll never overlaps it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let probes = 0;
  const { logger, warnings } = createLogger();
  const { monitor } = createMonitor(
    new FakeRepo([makeInstance({ hasWhatsappCreds: false })]),
    {
      gateway: async () => {
        probes += 1;
        await gate;
        return { healthy: true, degraded: null };
      },
      whatsapp: async () => "connected",
    },
    { now: 1_000 },
    logger,
  );

  const first = monitor.pollAll();
  await monitor.pollAll();
  assert.deepEqual(warnings, ["health monitor poll skipped; previous pass still running"]);

  let stopped = false;
  const stopping = monitor.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false, "stop waits for the poll");

  release();
  await first;
  await stopping;
  assert.equal(stopped, true);
  assert.equal(probes, 1, "only the first poll probed");
});

test("liveness observer gets down only when the gateway itself fails", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const observer = new RecordingObserver();
  let gatewayUp = false;
  const { monitor } = createMonitor(
    repo,
    {
      gateway: async () => ({ healthy: gatewayUp, degraded: null }),
      whatsapp: async () => "disconnected",
    },
    { now: 1_000 },
    silentLogger,
    { observer },
  );

  await monitor.pollAll();
  gatewayUp = true;
  await monitor.pollAll();

  // A disconnected channel degrades the row but is not a hang; only the dead gateway is "down".
  assert.deepEqual(observer.samples, [
    { id: "instance-1", sample: "down" },
    { id: "instance-1", sample: "live" },
  ]);
  // The row still counts the disconnect as a failure; the observer alone separates the two.
  assert.equal(repo.healthUpdates[1]?.failures, 1);
});

test("a container Docker still reports as starting is booting, not down", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const observer = new RecordingObserver();
  const { monitor } = createMonitor(
    repo,
    {
      gateway: async () => ({ healthy: false, degraded: null }),
      whatsapp: async () => "connected",
    },
    { now: 1_000 },
    silentLogger,
    { observer, runtime: fakeRuntime({ ...SETTLED, health: "starting" }) },
  );

  await monitor.pollAll();

  assert.deepEqual(observer.samples, [{ id: "instance-1", sample: "booting" }]);
  // The row still counts the failure exactly as before.
  assert.deepEqual(repo.healthUpdates, [{ id: "instance-1", failures: 1, status: "running" }]);
});

test("a container Docker is restarting, or one started moments ago, is booting too", async () => {
  const clock = { now: 10_000_000 };
  const cases: ContainerState[] = [
    { ...SETTLED, restarting: true },
    { ...SETTLED, startedAt: new Date(clock.now - 60_000) },
  ];
  for (const state of cases) {
    const observer = new RecordingObserver();
    const { monitor } = createMonitor(
      new FakeRepo([makeInstance()]),
      { gateway: async () => ({ healthy: false, degraded: null }), whatsapp: async () => "connected" },
      clock,
      silentLogger,
      { observer, runtime: fakeRuntime(state) },
    );
    await monitor.pollAll();
    assert.deepEqual(observer.samples, [{ id: "instance-1", sample: "booting" }]);
  }
});

test("a container that started long ago is down when its gateway fails", async () => {
  const clock = { now: 10_000_000 };
  const observer = new RecordingObserver();
  const { monitor } = createMonitor(
    new FakeRepo([makeInstance()]),
    { gateway: async () => ({ healthy: false, degraded: null }), whatsapp: async () => "connected" },
    clock,
    silentLogger,
    { observer, runtime: fakeRuntime({ ...SETTLED, startedAt: new Date(clock.now - 3_600_000) }) },
  );

  await monitor.pollAll();

  assert.deepEqual(observer.samples, [{ id: "instance-1", sample: "down" }]);
});

test("a container Docker cannot tell us about is unknown, never down", async () => {
  const cases = [fakeRuntime(null, { throws: true }), fakeRuntime(null, { byName: null })];
  for (const rt of cases) {
    const repo = new FakeRepo([makeInstance()]);
    const observer = new RecordingObserver();
    const { monitor } = createMonitor(
      repo,
      { gateway: async () => ({ healthy: false, degraded: null }), whatsapp: async () => "connected" },
      { now: 1_000 },
      silentLogger,
      { observer, runtime: rt },
    );
    await monitor.pollAll();
    assert.deepEqual(observer.samples, [{ id: "instance-1", sample: "unknown" }]);
    // The row is still marked, so the dashboard shows the problem.
    assert.equal(repo.healthUpdates[0]?.failures, 1);
  }
});

test("a probe that throws on a settled container is down", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const observer = new RecordingObserver();
  const { monitor } = createMonitor(
    repo,
    {
      gateway: async () => {
        throw new Error("boom");
      },
      whatsapp: async () => "connected",
    },
    { now: 1_000 },
    silentLogger,
    { observer },
  );

  await monitor.pollAll();

  assert.deepEqual(observer.samples, [{ id: "instance-1", sample: "down" }]);
});

test("the observer gets one report per poll covering exactly the active set", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const observer = new RecordingObserver();
  const { monitor } = createMonitor(
    repo,
    { whatsapp: async () => "connected" },
    { now: 1_000 },
    silentLogger,
    { observer },
  );

  await monitor.pollAll();
  repo.setInstances([]);
  await monitor.pollAll();

  assert.deepEqual(observer.reports, [[{ id: "instance-1", sample: "live" }], []]);
});

test("an observer that throws never breaks the health pass", async () => {
  const repo = new FakeRepo([makeInstance()]);
  const observer = {
    observe: () => {
      throw new Error("observer bug");
    },
  };
  const { monitor } = createMonitor(
    repo,
    { whatsapp: async () => "connected" },
    { now: 1_000 },
    silentLogger,
    { observer },
  );

  await monitor.pollAll();
  await monitor.pollAll();

  assert.equal(repo.healthUpdates.length, 2);
});

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

test("an unreachable host: nothing is probed or written, and every bot is reported unknown", async () => {
  const rows = [makeInstance({ id: "a", status: "degraded", healthFailures: 6 }), makeInstance({ id: "b" })];
  const repo = new FakeRepo(rows);
  const observer = new RecordingObserver();
  const { rt, calls } = countingRuntime();
  let reachable = false;
  const { monitor, whatsappCalls } = createMonitor(
    repo,
    { gateway: async () => ({ healthy: true, degraded: null }), whatsapp: async () => "connected" },
    { now: 0 },
    silentLogger,
    { observer, runtime: rt, reachable: () => reachable },
  );

  await monitor.pollAll();
  assert.deepEqual(calls, { state: 0, byName: 0 });
  assert.equal(repo.healthUpdates.length, 0);
  assert.equal(whatsappCalls(), 0);
  assert.deepEqual(observer.reports, [[{ id: "a", sample: "unknown" }, { id: "b", sample: "unknown" }]]);

  reachable = true;
  await monitor.pollAll();
  assert.deepEqual(repo.healthUpdates.map((u) => [u.id, u.failures, u.status]), [["a", 0, "running"], ["b", 0, "running"]]);
  assert.deepEqual(observer.reports.at(-1), [{ id: "a", sample: "live" }, { id: "b", sample: "live" }]);
});

test("hosts are gated one by one: an unreachable host reports unknown while a reachable one is probed", async () => {
  const rows = [
    makeInstance({ id: "a", hostId: "local-dev", hasWhatsappCreds: false, lastSeenAt: null }),
    makeInstance({ id: "b", hostId: "worker-1", hasWhatsappCreds: false, lastSeenAt: null }),
  ];
  const repo = new FakeRepo(rows);
  const observer = new RecordingObserver();
  const probes: Record<string, number> = {};
  const docker: Record<string, ReturnType<typeof countingRuntime>> = {};
  const bundle = (hostId: string, reachable: boolean): HostRuntime => {
    docker[hostId] = countingRuntime();
    const adapter = {
      kind: "openclaw",
      probeGateway: async () => {
        probes[hostId] = (probes[hostId] ?? 0) + 1;
        return { healthy: true, degraded: null };
      },
    } as unknown as AgentRuntimeAdapter;
    return {
      hostId,
      address: null,
      capacityMb: null,
      status: "active",
      restartPolicy: "unless-stopped",
      dockerNetwork: true,
      runtime: docker[hostId].rt,
      adapters: { get: () => adapter } as unknown as AgentRuntimeRegistry,
      gate: { check: async () => reachable },
    };
  };
  const bundles = { "local-dev": bundle("local-dev", true), "worker-1": bundle("worker-1", false) };
  const hosts: HostRuntimes = {
    for: (hostId) => bundles[hostId as keyof typeof bundles],
    all: () => Object.values(bundles),
  };
  const monitor = new HealthMonitor(repo as never, hosts, silentLogger, MONITOR_CONFIG, () => 1_000, observer);

  await monitor.pollAll();

  assert.deepEqual(probes, { "local-dev": 1 });
  assert.deepEqual(docker["worker-1"]?.calls, { state: 0, byName: 0 });
  assert.deepEqual(repo.healthUpdates.map((u) => u.id), ["a"]);
  assert.deepEqual(observer.reports, [[{ id: "a", sample: "live" }, { id: "b", sample: "unknown" }]]);
});

test("probes on a worker dial its address and the bot's published port", async () => {
  const rows = [makeInstance({ id: "a", hostId: "worker-1", gatewayPort: 19042, hasWhatsappCreds: false, lastSeenAt: null })];
  const repo = new FakeRepo(rows);
  const dialed: string[] = [];
  const adapter = {
    kind: "openclaw",
    internalPort: 18789,
    probeGateway: async (_inst: Instance, _timeout: number, baseUrl: string) => {
      dialed.push(baseUrl);
      return { healthy: true, degraded: null };
    },
  } as unknown as AgentRuntimeAdapter;
  const hosts = singleHost(
    countingRuntime().rt,
    { get: () => adapter } as unknown as AgentRuntimeRegistry,
    { check: async () => true },
    { address: "10.0.0.9", restartPolicy: "no" },
  );
  const monitor = new HealthMonitor(repo as never, hosts, silentLogger, MONITOR_CONFIG, () => 1_000, null);

  await monitor.pollAll();

  assert.deepEqual(dialed, ["http://10.0.0.9:19042"]);
});

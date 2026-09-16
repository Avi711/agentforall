import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { HealthMonitor } from "../src/services/health-monitor.js";
import { AutoRestarter, type SystemRestartOutcome } from "../src/services/auto-restarter.js";
import type { ContainerRuntime, ContainerState } from "../src/services/container-runtime.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";
import { singleHost } from "./helpers/host-runtimes.js";

const FAILURE_THRESHOLD = 4;
const SETTLED: ContainerState = { running: true, restarting: false, health: "healthy", startedAt: null };

function harness(options: { gatewayUp?: () => boolean; state?: ContainerState; reachable?: () => boolean } = {}) {
  const inst = makeInstance([], { hasWhatsappCreds: false, lastSeenAt: null });
  const restarts: string[] = [];
  const healthWrites: number[] = [];
  const clock = { now: 10_000_000 };
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;

  const repo = {
    findByStatuses: async (): Promise<Instance[]> => [inst],
    updateHealth: async (_id: string, failures: number) => void healthWrites.push(failures),
    updatePairing: async () => {},
    updateContainerId: async () => {},
  };
  const runtime = {
    containerState: async () => options.state ?? SETTLED,
    findContainerByName: async () => inst.containerId,
  } as unknown as ContainerRuntime;
  const adapters = {
    get: () => ({
      kind: "openclaw",
      probeGateway: async () => ({ healthy: options.gatewayUp?.() ?? false, degraded: null }),
    }),
  } as unknown as AgentRuntimeRegistry;
  const manager = {
    restartBySystem: async (id: string): Promise<SystemRestartOutcome> => {
      restarts.push(id);
      return { restarted: true };
    },
  };

  const restarter = new AutoRestarter(
    manager,
    { append: async () => {} },
    logger,
    { failureThreshold: FAILURE_THRESHOLD, cooldownMs: 600_000, maxRestartsPerWindow: 3, windowMs: 3_600_000 },
    () => clock.now,
  );
  const monitor = new HealthMonitor(
    repo as never,
    singleHost(runtime, adapters, { check: async () => options.reachable?.() ?? true }),
    logger,
    {
      pollIntervalMs: 15_000,
      channelPollIntervalMs: 60_000,
      channelStateMaxAgeMs: 600_000,
      channelProbeMaxBackoffMs: 900_000,
      degradedThreshold: 5,
      unhealthyThreshold: 10,
      requestTimeoutMs: 1_000,
      channelProbeTimeoutMs: 1_000,
      maxConcurrentChecks: 4,
    },
    () => clock.now,
    restarter,
  );

  const poll = async (times = 1) => {
    for (let i = 0; i < times; i++) {
      await monitor.pollAll();
      await restarter.settle();
      clock.now += 15_000;
    }
  };
  return { inst, poll, restarts, healthWrites };
}

test("a container that is not running is the reconciler's business: no failure is counted and the row is not written", async () => {
  const stopped = harness({ state: { ...SETTLED, running: false } });
  await stopped.poll(5);
  assert.deepEqual(stopped.healthWrites, [], "a write would bump updated_at and keep the reconciler away for good");

  const down = harness();
  await down.poll(2);
  assert.equal(down.healthWrites.length, 2, "a running bot that does not answer still counts");
});

test("four failed polls on a settled bot produce exactly one system restart", async () => {
  const h = harness();

  await h.poll(FAILURE_THRESHOLD - 1);
  assert.deepEqual(h.restarts, []);

  await h.poll();
  assert.deepEqual(h.restarts, [h.inst.id]);

  await h.poll(2);
  assert.equal(h.restarts.length, 1, "cooldown holds across further failing polls");
});

test("a bot that answers again before the threshold is never restarted", async () => {
  let up = false;
  const h = harness({ gatewayUp: () => up });

  await h.poll(FAILURE_THRESHOLD - 1);
  up = true;
  await h.poll();
  up = false;
  await h.poll(FAILURE_THRESHOLD - 1);

  assert.deepEqual(h.restarts, []);
});

test("a container Docker still reports as starting is never restarted however long it fails", async () => {
  const h = harness({ state: { ...SETTLED, health: "starting" } });

  await h.poll(FAILURE_THRESHOLD * 3);

  assert.deepEqual(h.restarts, []);
});

test("a Docker outage in the middle of a failing streak neither counts nor resets it", async () => {
  let reachable = true;
  const h = harness({ reachable: () => reachable });

  await h.poll(FAILURE_THRESHOLD - 1);
  reachable = false;
  await h.poll(5);
  assert.deepEqual(h.restarts, [], "unreachable polls never restart");

  reachable = true;
  await h.poll();
  assert.deepEqual(h.restarts, [h.inst.id], "the streak resumes where it stopped");
});

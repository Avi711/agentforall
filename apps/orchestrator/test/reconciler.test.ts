import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { Reconciler } from "../src/services/reconciler.js";
import type { Instance, InstanceStatus } from "../src/domain/types.js";
import type { RestartPolicy } from "../src/services/container-runtime.js";
import { makeInstance } from "./helpers/fixtures.js";
import { singleHost } from "./helpers/host-runtimes.js";

const OLD = new Date("2026-08-21T00:00:00.000Z");

function harness(
  rows: Instance[],
  docker: { known: Record<string, boolean | "restarting">; byName: string | null },
  operating: (id: string) => boolean = () => false,
  restartPolicy: RestartPolicy = "unless-stopped",
  clock = { now: 1_000_000 },
) {
  const events: string[] = [];
  const errors: string[] = [];
  const statusUpdates: { id: string; status: InstanceStatus }[] = [];
  const containerIdUpdates: { id: string; containerId: string }[] = [];
  const started: string[] = [];
  const repo = {
    findStaleProvisioning: async () => [],
    findByStatuses: async (statuses: InstanceStatus[]) => rows.filter((r) => statuses.includes(r.status)),
    updateStatus: async (id: string, status: InstanceStatus) => {
      statusUpdates.push({ id, status });
      return true;
    },
    updateContainerId: async (id: string, containerId: string) => {
      containerIdUpdates.push({ id, containerId });
    },
    updatePairing: async () => {},
  };
  const byNameLookups = { count: 0 };
  const runtime = {
    containerState: async (id: string) =>
      id in docker.known
        ? { running: docker.known[id] === true, restarting: docker.known[id] === "restarting", health: "none", startedAt: null }
        : null,
    findContainerByName: async () => {
      byNameLookups.count += 1;
      return docker.byName;
    },
    remove: async () => {},
    removeVolume: async () => {},
    start: async (id: string) => {
      started.push(id);
    },
  };
  const reconciler = new Reconciler({
    repo: repo as never,
    hosts: singleHost(
      runtime as never,
      { get: () => ({ stateVolumeName: (id: string) => `oc-${id}-state` }) } as never,
      undefined,
      { restartPolicy },
    ),
    manager: { resumeProvisioning: async () => undefined, isOperating: operating, purgeMovedSources: async () => {} } as never,
    pairingManager: { expireStale: async () => {} } as never,
    events: { append: async (_id: string, type: string) => void events.push(type) },
    logger: { info: () => {}, warn: () => {}, error: (_: unknown, msg: string) => void errors.push(msg) } as unknown as FastifyBaseLogger,
    pairingStaleThresholdMs: 900_000,
    readopt: { maxPerWindow: 2, windowMs: 60_000 },
    now: () => clock.now,
  });
  return { reconciler, statusUpdates, containerIdUpdates, byNameLookups, started, events, errors };
}

test("re-adopting a container that keeps exiting spends the auto-restart budget, then the row goes stopped with the exhausted alert", async () => {
  const row = makeInstance([], { containerId: "container-1", updatedAt: OLD });
  const clock = { now: 1_000_000 };
  const h = harness([row], { known: { "container-1": false }, byName: null }, undefined, "no", clock);
  for (let i = 0; i < 3; i += 1) {
    await h.reconciler.run();
    clock.now += 1_000;
  }
  assert.deepEqual(h.started, ["container-1", "container-1"]);
  assert.deepEqual(h.events, ["instance.auto_restart_exhausted"]);
  assert.deepEqual(h.errors, ["auto restart budget exhausted; bot needs manual attention"]);
  assert.deepEqual(h.statusUpdates, [{ id: row.id, status: "stopped" }], "a stopped row leaves the running set; a user start brings it back");

  clock.now += 60_000;
  await h.reconciler.run();
  assert.equal(h.started.length, 3, "a fresh window (a later user start that failed again) gets a new budget");
});

test("a stopped container on a no-policy host is started and the row stays running; an unless-stopped host marks it stopped", async () => {
  const row = makeInstance([], { containerId: "container-1", updatedAt: OLD });

  const remote = harness([row], { known: { "container-1": false }, byName: null }, undefined, "no");
  await remote.reconciler.run();
  assert.deepEqual(remote.started, ["container-1"]);
  assert.deepEqual(remote.statusUpdates, []);

  const local = harness([row], { known: { "container-1": false }, byName: null }, undefined, "unless-stopped");
  await local.reconciler.run();
  assert.deepEqual(local.started, []);
  assert.deepEqual(local.statusUpdates, [{ id: row.id, status: "stopped" }]);
});

test("a known container that is not running marks the row stopped without a name lookup", async () => {
  const row = makeInstance([], { containerId: "container-1", updatedAt: OLD });
  const h = harness([row], { known: { "container-1": false }, byName: null });

  await h.reconciler.run();

  assert.deepEqual(h.statusUpdates, [{ id: row.id, status: "stopped" }]);
  assert.equal(h.byNameLookups.count, 0);
  assert.deepEqual(h.containerIdUpdates, []);
});

test("a container Docker is restarting is left alone: the row stays running and nothing is started", async () => {
  const row = makeInstance([], { containerId: "container-1", updatedAt: OLD });
  const h = harness([row], { known: { "container-1": "restarting" }, byName: null });
  await h.reconciler.run();
  assert.deepEqual(h.statusUpdates, []);
  assert.deepEqual(h.started, []);
});

test("a row under an operation lock is left alone even when its container is down", async () => {
  const row = makeInstance([], { containerId: "container-1", updatedAt: OLD });
  const h = harness([row], { known: { "container-1": false }, byName: null }, (id) => id === row.id);

  await h.reconciler.run();

  assert.deepEqual(h.statusUpdates, []);
});

test("a running row whose container id lags is repaired by name instead of being marked error", async () => {
  const row = makeInstance([], { containerId: "stale", updatedAt: OLD });
  const h = harness([row], { known: { "container-2": true }, byName: "container-2" });

  await h.reconciler.run();

  assert.deepEqual(h.containerIdUpdates, [{ id: row.id, containerId: "container-2" }]);
  assert.deepEqual(h.statusUpdates, []);
});

test("a row without any container under its name is marked error", async () => {
  const row = makeInstance([], { containerId: "stale", updatedAt: OLD });
  const h = harness([row], { known: {}, byName: null });

  await h.reconciler.run();

  assert.deepEqual(h.statusUpdates, [{ id: row.id, status: "error" }]);
});

test("a stopped container found by name marks the row stopped", async () => {
  const row = makeInstance([], { containerId: null, updatedAt: OLD });
  const h = harness([row], { known: { "container-2": false }, byName: "container-2" });

  await h.reconciler.run();

  assert.deepEqual(h.containerIdUpdates, [{ id: row.id, containerId: "container-2" }]);
  assert.deepEqual(h.statusUpdates, [{ id: row.id, status: "stopped" }]);
});

test("rows touched within the freshness grace are left alone", async () => {
  const row = makeInstance([], { containerId: "stale", updatedAt: new Date() });
  const h = harness([row], { known: {}, byName: null });

  await h.reconciler.run();

  assert.deepEqual(h.statusUpdates, []);
});

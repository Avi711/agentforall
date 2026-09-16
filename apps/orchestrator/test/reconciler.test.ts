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
  docker: { known: Record<string, boolean>; byName: string | null },
  operating: (id: string) => boolean = () => false,
  restartPolicy: RestartPolicy = "unless-stopped",
) {
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
      id in docker.known ? { running: docker.known[id], restarting: false, health: "none", startedAt: null } : null,
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
    logger: { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger,
    pairingStaleThresholdMs: 900_000,
  });
  return { reconciler, statusUpdates, containerIdUpdates, byNameLookups, started };
}

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

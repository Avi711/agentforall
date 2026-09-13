import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { Reconciler } from "../src/services/reconciler.js";
import type { Instance, InstanceStatus } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const OLD = new Date("2026-08-21T00:00:00.000Z");

function harness(rows: Instance[], docker: { known: Record<string, boolean>; byName: string | null }) {
  const statusUpdates: { id: string; status: InstanceStatus }[] = [];
  const containerIdUpdates: { id: string; containerId: string }[] = [];
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
  const runtime = {
    inspect: async (id: string) => (id in docker.known ? { State: { Running: docker.known[id] } } : null),
    findContainerByName: async () => docker.byName,
    remove: async () => {},
    removeVolume: async () => {},
  };
  const reconciler = new Reconciler({
    repo: repo as never,
    runtime: runtime as never,
    runtimes: { get: () => ({ stateVolumeName: (id: string) => `oc-${id}-state` }) } as never,
    manager: { resumeProvisioning: async () => undefined } as never,
    pairingManager: { expireStale: async () => {} } as never,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger,
    pairingStaleThresholdMs: 900_000,
  });
  return { reconciler, statusUpdates, containerIdUpdates };
}

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

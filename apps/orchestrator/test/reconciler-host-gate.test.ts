import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { Reconciler } from "../src/services/reconciler.js";
import type { HostRuntime, HostRuntimes } from "../src/services/host-runtimes.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const OLD = new Date("2026-08-21T00:00:00.000Z");

function harness(options: {
  reachable: (hostId: string) => boolean;
  stateOf?: (id: string) => boolean | Error;
  hostOf?: (id: string) => string;
  operating?: (id: string) => boolean;
  destroying?: Instance[];
  removeError?: Error;
}) {
  const hostOf = options.hostOf ?? (() => "host");
  const rows: Instance[] = [
    makeInstance([], { id: "a", hostId: hostOf("a"), containerId: "container-a", updatedAt: OLD }),
    makeInstance([], { id: "b", hostId: hostOf("b"), containerId: "container-b", updatedAt: OLD }),
  ];
  const stale = [makeInstance([], { id: "p", hostId: hostOf("p"), status: "provisioning", updatedAt: OLD })];
  const inspected: string[] = [];
  const statusUpdates: { id: string; status: string }[] = [];
  const resumed: string[] = [];
  const expired: [number, string[]][] = [];
  let purges = 0;
  const warnings: string[] = [];
  const repo = {
    findByStatuses: async (statuses: string[]) =>
      statuses.includes("running") ? rows : statuses.includes("destroying") ? (options.destroying ?? []) : [],
    findStaleProvisioning: async () => stale,
    updateStatus: async (id: string, status: string) => void statusUpdates.push({ id, status }),
    updateContainerId: async () => {},
    updatePairing: async () => {},
  };
  const runtime = {
    containerState: async (id: string) => {
      inspected.push(id);
      const answer = options.stateOf?.(id) ?? true;
      if (answer instanceof Error) throw answer;
      return { running: answer, restarting: false, health: "none", startedAt: null };
    },
    findContainerByName: async () => null,
    remove: async () => {
      if (options.removeError) throw options.removeError;
    },
    removeVolume: async () => {},
  };
  const bundle = (hostId: string): HostRuntime => ({
    hostId,
    address: null,
    capacityMb: null,
    status: "active",
    restartPolicy: "unless-stopped",
    dockerNetwork: true,
    runtime: runtime as never,
    adapters: { get: () => ({ stateVolumeName: (id: string) => `oc-${id}-state` }) } as never,
    gate: { check: async () => options.reachable(hostId) },
  });
  const hostIds = new Set([...rows, ...stale].map((inst) => inst.hostId));
  const hosts: HostRuntimes = { for: bundle, all: () => [...hostIds].map(bundle) };
  const reconciler = new Reconciler({
    repo: repo as never,
    hosts,
    manager: {
      resumeProvisioning: async (id: string) => void resumed.push(id),
      isOperating: options.operating ?? (() => false),
      purgeMovedSources: async () => void purges++,
    } as never,
    pairingManager: { expireStale: async (ms: number, hostIds: string[]) => void expired.push([ms, hostIds]) } as never,
    events: { append: async () => {} },
    logger: { info: () => {}, warn: (_: unknown, msg: string) => void warnings.push(msg), error: () => {} } as unknown as FastifyBaseLogger,
    pairingStaleThresholdMs: 900_000,
    readopt: { maxPerWindow: 3, windowMs: 3_600_000 },
  });
  return { reconciler, statusUpdates, resumed, expired, inspected, warnings, purges: () => purges };
}

test("a destroy that cannot complete warns without the words the run-level alert matches on", async () => {
  const h = harness({
    reachable: () => true,
    destroying: [makeInstance([], { id: "d", hostId: "host", status: "destroying", containerId: "container-d", updatedAt: OLD })],
    removeError: new Error("volume is in use"),
  });
  await h.reconciler.run();
  assert.ok(h.warnings.includes("orphaned destroy could not complete"));
  assert.ok(!h.warnings.some((msg) => msg.includes("reconciliation failed")));
});

test("an unreachable host suspends the whole run: no provisioning resumes, no status writes, no pairing expiry", async () => {
  const h = harness({ reachable: () => false, stateOf: () => false });
  await h.reconciler.run();
  assert.deepEqual(h.statusUpdates, []);
  assert.deepEqual(h.resumed, []);
  assert.deepEqual(h.expired, [], "the sweep is not even called when no host answers");
});

test("a reachable host runs every phase", async () => {
  const h = harness({ reachable: () => true, stateOf: () => false });
  await h.reconciler.run();
  assert.deepEqual(h.resumed, ["p"]);
  assert.deepEqual(h.statusUpdates, [
    { id: "a", status: "stopped" },
    { id: "b", status: "stopped" },
  ]);
  assert.deepEqual(h.expired, [[900_000, ["host"]]]);
  assert.equal(h.purges(), 1, "the sweep is the manager's; the run only calls it");
});

test("a provisioning row under an operation (a move mid-boot) is not resumed, so the run never queues behind its lock", async () => {
  const h = harness({ reachable: () => true, stateOf: () => false, operating: (id) => id === "p" });
  await h.reconciler.run();
  assert.deepEqual(h.resumed, []);
  assert.deepEqual(h.statusUpdates, [
    { id: "a", status: "stopped" },
    { id: "b", status: "stopped" },
  ]);
});

test("one row's Docker error does not stop the others from being reconciled", async () => {
  const h = harness({ reachable: () => true, stateOf: (id) => (id === "container-a" ? new Error("EPIPE") : false) });
  await h.reconciler.run();
  assert.deepEqual(h.statusUpdates, [{ id: "b", status: "stopped" }]);
});

test("hosts are gated one by one: an unreachable host's rows are left alone while the reachable host is reconciled", async () => {
  const h = harness({
    reachable: (hostId) => hostId === "local-dev",
    stateOf: () => false,
    hostOf: (id) => (id === "a" ? "local-dev" : "worker-1"),
  });
  await h.reconciler.run();
  assert.deepEqual(h.inspected, ["container-a"]);
  assert.deepEqual(h.statusUpdates, [{ id: "a", status: "stopped" }]);
  assert.deepEqual(h.resumed, []);
  assert.deepEqual(h.expired, [[900_000, ["local-dev"]]], "pairing expiry runs for the hosts that answer");
});

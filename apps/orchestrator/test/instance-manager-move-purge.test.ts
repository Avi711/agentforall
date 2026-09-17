import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager } from "../src/services/instance-manager.js";
import { InstanceOperationLock } from "../src/services/instance-operation-lock.js";
import type { AppConfig } from "../src/config.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";
import { twoHosts } from "./helpers/host-runtimes.js";

const OLD = new Date("2026-08-21T00:00:00.000Z");
const RETENTION_MS = 24 * 60 * 60 * 1000;

function harness(
  due: Instance[],
  options: { sourceReachable?: boolean; sourceContainer?: string | null; current?: Instance | null; lock?: InstanceOperationLock; retentionMs?: number } = {},
) {
  const cleared: string[] = [];
  const warnings: string[] = [];
  const deletedObjects: string[] = [];
  const runtimeFor = (name: string) => {
    const removed: string[] = [];
    const removedVolumes: string[] = [];
    const runtime = {
      findContainerByName: async () => (name === "source" ? (options.sourceContainer ?? null) : null),
      remove: async (id: string) => void removed.push(id),
      removeVolume: async (volume: string) => void removedVolumes.push(volume),
    };
    return { runtime, removed, removedVolumes };
  };
  const source = runtimeFor("source");
  const target = runtimeFor("target");
  const adapters = { get: () => ({ stateVolumeName: (id: string) => `oc-${id}-state` }) } as never;
  const hosts = twoHosts(
    { hostId: "host-a", runtime: source.runtime as never, adapters, gate: { check: async () => options.sourceReachable ?? true } },
    { hostId: "host-b", runtime: target.runtime as never, adapters },
  );
  const repo = {
    findMovedSourcesDue: async (olderThanMs: number) => {
      assert.equal(olderThanMs, options.retentionMs ?? RETENTION_MS);
      return due;
    },
    findById: async (id: string) => (options.current === undefined ? due.find((inst) => inst.id === id) ?? null : options.current),
    clearMove: async (id: string) => void cleared.push(id),
  };
  const manager = new InstanceManager(
    repo as never,
    hosts,
    {} as never,
    {} as never,
    { moveSourceRetentionMs: options.retentionMs ?? RETENTION_MS } as AppConfig,
    { append: async () => {} } as never,
    {} as never,
    {} as never,
    { info: () => {}, warn: (_: unknown, msg: string) => void warnings.push(msg), error: () => {} } as unknown as FastifyBaseLogger,
    null,
    options.lock,
    null,
    null,
    null,
    { deleteObject: async (name: string) => void deletedObjects.push(name) } as never,
  );
  return { manager, source, target, cleared, warnings, deletedObjects };
}

const moved = makeInstance([], {
  id: "m1",
  hostId: "host-b",
  containerId: "tgt-1",
  containerName: "openclaw-m1",
  movedFromHostId: "host-a",
  movedAt: OLD,
  updatedAt: OLD,
});

test("a due row: the container left under the name and the volume go from the source host, then the move columns clear", async () => {
  const h = harness([moved], { sourceContainer: "src-1" });

  await h.manager.purgeMovedSources();

  assert.deepEqual(h.source.removed, ["src-1"]);
  assert.deepEqual(h.source.removedVolumes, ["oc-m1-state"]);
  assert.deepEqual(h.target.removed, []);
  assert.deepEqual(h.target.removedVolumes, []);
  assert.deepEqual(h.cleared, ["m1"]);
});

test("a destroyed row is purged too, even one whose move never finished, and no container left on the source is fine", async () => {
  const h = harness([{ ...moved, status: "destroyed", containerId: null, moveObjectName: "moves/m1.tar" }], { sourceContainer: null });

  await h.manager.purgeMovedSources();

  assert.deepEqual(h.source.removed, []);
  assert.deepEqual(h.source.removedVolumes, ["oc-m1-state"]);
  assert.deepEqual(h.deletedObjects, ["moves/m1.tar"]);
  assert.deepEqual(h.cleared, ["m1"]);
});

test("the old copy is the rollback while the move never finished: provisioning rows and any row still carrying the object are kept", async () => {
  for (const row of [
    { ...moved, status: "error" as const, containerId: null, moveObjectName: "moves/m1.tar" },
    { ...moved, status: "provisioning" as const, containerId: null },
    { ...moved, moveObjectName: "moves/m1.tar" },
  ]) {
    const h = harness([row], { sourceContainer: "src-1" });
    await h.manager.purgeMovedSources();
    assert.deepEqual(h.source.removed, [], row.status);
    assert.deepEqual(h.source.removedVolumes, [], row.status);
    assert.deepEqual(h.cleared, [], row.status);
  }
});

test("a row that went to error long after its move completed is swept like any other: the old copy is stale", async () => {
  const h = harness([{ ...moved, status: "error", moveObjectName: null }], { sourceContainer: "src-1" });

  await h.manager.purgeMovedSources();

  assert.deepEqual(h.source.removed, ["src-1"]);
  assert.deepEqual(h.source.removedVolumes, ["oc-m1-state"]);
  assert.deepEqual(h.cleared, ["m1"]);
});

test("an unreachable source host is skipped and the row keeps its move columns", async () => {
  const h = harness([moved], { sourceReachable: false, sourceContainer: "src-1" });

  await h.manager.purgeMovedSources();

  assert.deepEqual(h.source.removed, []);
  assert.deepEqual(h.source.removedVolumes, []);
  assert.deepEqual(h.cleared, []);
});

test("a source host this orchestrator no longer manages is left alone with a warning", async () => {
  const h = harness([{ ...moved, movedFromHostId: "host-z" }], { sourceContainer: "src-1" });

  await h.manager.purgeMovedSources();

  assert.deepEqual(h.cleared, []);
  assert.deepEqual(h.warnings, ["moved source purge failed"]);
});

test("a row under an operation is skipped, and the row is re-read under the lock so a move that landed meanwhile keeps its new retention reference", async () => {
  const lock = new InstanceOperationLock();
  let release!: () => void;
  const held = lock.run("m1", () => new Promise<void>((resolve) => (release = resolve)));
  const busy = harness([moved], { sourceContainer: "src-1", lock });
  await busy.manager.purgeMovedSources();
  assert.deepEqual(busy.source.removedVolumes, []);
  assert.deepEqual(busy.cleared, []);
  release();
  await held;

  const removed = harness([moved], { sourceContainer: "src-1", current: { ...moved, movedFromHostId: "host-b", hostId: "host-a", movedAt: new Date() } });
  await removed.manager.purgeMovedSources();
  assert.deepEqual(removed.source.removedVolumes, []);
  assert.deepEqual(removed.target.removedVolumes, []);
  assert.deepEqual(removed.cleared, []);

  const rolledBack = harness([moved], { sourceContainer: "src-1", current: { ...moved, movedFromHostId: null, movedAt: null } });
  await rolledBack.manager.purgeMovedSources();
  assert.deepEqual(rolledBack.cleared, []);
});

test("a row whose previous host is its current host (a hand-edited row) is never purged: that volume is the live one", async () => {
  const h = harness([{ ...moved, movedFromHostId: "host-b" }], { sourceContainer: "src-1" });

  await h.manager.purgeMovedSources();

  assert.deepEqual(h.target.removed, []);
  assert.deepEqual(h.target.removedVolumes, []);
  assert.deepEqual(h.cleared, []);
});

test("the retention window is configuration: a short window purges a copy the default would still keep", async () => {
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
  const recent = { ...moved, movedAt: twentyMinutesAgo, updatedAt: twentyMinutesAgo };

  const kept = harness([recent]);
  await kept.manager.purgeMovedSources();
  assert.deepEqual(kept.cleared, []);

  const short = harness([recent], { retentionMs: 15 * 60 * 1000 });
  await short.manager.purgeMovedSources();
  assert.deepEqual(short.source.removedVolumes, ["oc-m1-state"]);
  assert.deepEqual(short.cleared, ["m1"]);
});

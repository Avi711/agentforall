import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager, type MoveStorage } from "../src/services/instance-manager.js";
import type { ContainerCreateOptions, ContainerRuntime, ContainerState } from "../src/services/container-runtime.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";
import type { Instance, InstanceStatus } from "../src/domain/types.js";
import type { MoveBackInput, MoveToInput } from "../src/storage/instance-repository.js";
import { NoPlacementError } from "../src/domain/errors.js";
import { makeInstance } from "./helpers/fixtures.js";
import { twoHosts } from "./helpers/host-runtimes.js";

const ID = "4b86fc8b-ef19-496b-9591-583c72069443";
const SOURCE = "host-a";
const TARGET = "host-b";

function bot(overrides: Partial<Instance> = {}): Instance {
  return makeInstance([{ type: "whatsapp" }], {
    id: ID,
    hostId: SOURCE,
    containerId: "src-1",
    containerName: "openclaw-4b86fc8b-ef1",
    gatewayPort: 19000,
    pairingStatus: "paired",
    ...overrides,
  });
}

test("a dry run stops, exports, deletes the object, restarts, and leaves the row on the source", async () => {
  const h = harness(bot());

  await h.manager.move(ID, TARGET, { dryRun: true });

  assert.deepEqual(h.source.stopped, ["src-1"]);
  assert.deepEqual(h.source.exported, ["src-1"]);
  assert.equal(h.storage.uploads.length, 1);
  assert.deepEqual(h.storage.deleted, h.storage.uploads);
  assert.deepEqual(h.source.started, ["src-1"]);
  assert.deepEqual(h.repo.moves, []);
  assert.equal(h.repo.instance.hostId, SOURCE);
  assert.equal(h.repo.instance.status, "running");
  assert.deepEqual(h.target.created, []);
  assert.deepEqual(h.source.removed, []);
  assert.ok(h.events.includes("move.dry_run"));
  assert.ok(!h.events.includes("move.flipped"));
});

test("a full move: stopped first, export before the flip, one moveTo, source removed after, object deleted only once healthy", async () => {
  const h = harness(bot());

  await h.manager.move(ID, TARGET);

  assert.deepEqual(h.order.slice(0, 4), ["status:stopped", "stop:src-1", "export:src-1", "upload"]);
  assert.ok(h.order.indexOf("moveTo") > h.order.indexOf("upload"));
  assert.ok(h.order.indexOf("remove:src-1") > h.order.indexOf("moveTo"));
  assert.ok(h.order.indexOf("import:tgt-1") > h.order.indexOf("remove:src-1"));
  assert.ok(h.order.indexOf("delete") > h.order.indexOf("healthy:tgt-1"));
  assert.equal(h.repo.moves.length, 1);
  // Ports are per host: the target's range starts fresh.
  assert.deepEqual(h.repo.moves[0], {
    fromHostId: SOURCE,
    toHostId: TARGET,
    gatewayPort: 19000,
    objectName: h.storage.uploads[0],
    keepStopped: false,
  });
  assert.ok(h.source.signals[0] instanceof AbortSignal && h.target.signals[0] instanceof AbortSignal, "both streams carry a deadline");
  assert.deepEqual(h.source.removed, ["src-1"]);
  assert.deepEqual(h.source.removedVolumes, []);
  assert.deepEqual(h.target.created, ["tgt-1"]);
  assert.deepEqual(h.target.started, ["tgt-1"]);
  assert.deepEqual(h.target.imported, ["tgt-1"]);
  assert.deepEqual(h.target.prepared, [ID]);
  assert.deepEqual(h.storage.deleted, h.storage.uploads);
  assert.equal(h.repo.instance.hostId, TARGET);
  assert.equal(h.repo.instance.status, "running");
  assert.equal(h.repo.instance.containerId, "tgt-1");
  assert.equal(h.repo.instance.moveObjectName, null);
  assert.equal(h.repo.instance.movedFromHostId, SOURCE);
  assert.deepEqual(
    h.events.filter((e) => e.startsWith("move.")),
    ["move.started", "move.exported", "move.flipped", "move.completed"],
  );
});

test("a port taken on the target between allocation and the flip is retried with the next port", async () => {
  const h = harness(bot(), { moveToConflicts: 1 });

  await h.manager.move(ID, TARGET);

  assert.deepEqual(h.repo.moves.map((m) => m.gatewayPort), [19000, 19001]);
  assert.equal(h.repo.instance.gatewayPort, 19001);
  assert.equal(h.storage.uploads.length, 1);
});

test("when the target boot fails the row is error on the target, the object is kept and the source volume too", async () => {
  const h = harness(bot(), { importError: new Error("import failed") });

  await assert.rejects(() => h.manager.move(ID, TARGET), /import failed/);

  assert.equal(h.repo.instance.hostId, TARGET);
  assert.equal(h.repo.instance.status, "error");
  assert.equal(h.repo.instance.movedFromHostId, SOURCE);
  assert.equal(h.repo.instance.moveObjectName, h.storage.uploads[0]);
  assert.deepEqual(h.storage.deleted, []);
  assert.deepEqual(h.source.removedVolumes, []);
  assert.deepEqual(h.target.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(h.events.at(-1), "move.failed");
});

test("an export failure before the flip deletes the object and brings the source back up", async () => {
  const h = harness(bot(), { exportError: new Error("archive failed") });

  await assert.rejects(() => h.manager.move(ID, TARGET), /archive failed/);

  assert.deepEqual(h.repo.moves, []);
  assert.equal(h.repo.instance.hostId, SOURCE);
  assert.equal(h.repo.instance.status, "running");
  assert.deepEqual(h.source.started, ["src-1"]);
  // Nothing was uploaded; the best-effort delete still names the object a partial upload could have left.
  assert.deepEqual(h.storage.uploads, []);
  assert.equal(h.storage.deleted.length, 1);
  assert.match(h.storage.deleted[0] ?? "", new RegExp(`^moves/${ID}/`));
  assert.ok(h.events.includes("move.failed"));
});

test("a bot that was stopped stays stopped after a dry run", async () => {
  const h = harness(bot({ status: "stopped" }), { sourceRunning: false });

  await h.manager.move(ID, TARGET, { dryRun: true });

  assert.deepEqual(h.source.stopped, []);
  assert.deepEqual(h.source.started, []);
  assert.equal(h.repo.instance.status, "stopped");
});

test("the same host, a pairing in flight, a provisioning row and a missing bucket are refused before anything is touched", async () => {
  for (const [inst, target, message] of [
    [bot(), SOURCE, /already on that host/],
    [bot({ pairingStatus: "awaiting_qr" }), TARGET, /awaiting_qr/],
    [bot({ pairingStatus: "awaiting_code" }), TARGET, /awaiting_code/],
    [bot({ status: "provisioning" }), TARGET, /provisioning/],
  ] as const) {
    const h = harness(inst);
    await assert.rejects(() => h.manager.move(ID, target), message);
    assert.deepEqual(h.source.stopped, []);
    assert.deepEqual(h.storage.uploads, []);
    assert.equal(h.repo.instance.status, inst.status);
  }

  const unset = harness(bot(), { storage: null });
  await assert.rejects(() => unset.manager.move(ID, TARGET), (err: unknown) => {
    assert.equal((err as { code?: string }).code, "FEATURE_UNAVAILABLE");
    assert.equal((err as { statusCode?: number }).statusCode, 503);
    return true;
  });
  assert.deepEqual(unset.source.stopped, []);
});

test("an unknown target is a validation error and a full target propagates the placement refusal", async () => {
  const unknown = harness(bot());
  await assert.rejects(() => unknown.manager.move(ID, "host-z"), (err: unknown) => {
    assert.equal((err as { code?: string }).code, "VALIDATION_ERROR");
    return true;
  });

  const full = harness(bot(), { placementError: new NoPlacementError() });
  await assert.rejects(() => full.manager.move(ID, TARGET), NoPlacementError);
  assert.deepEqual(full.source.stopped, []);
  assert.equal(full.repo.instance.status, "running");
});

test("a target that already holds a volume for the bot is refused, unless the bot is moving back within retention", async () => {
  const taken = harness(bot(), { targetVolumes: ["oc-4b86fc8b-ef1-state"] });
  await assert.rejects(() => taken.manager.move(ID, TARGET), /already holds a state volume/);
  assert.deepEqual(taken.source.stopped, []);

  const back = harness(bot({ movedFromHostId: TARGET, movedAt: new Date() }), { targetVolumes: ["oc-4b86fc8b-ef1-state"] });
  await back.manager.move(ID, TARGET);
  assert.deepEqual(back.target.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(back.repo.instance.hostId, TARGET);
  assert.equal(back.repo.instance.status, "running");
});

test("the rollback path: an error row moved back to its old host gets a port there, no export, status stays error", async () => {
  const h = harness(bot({ hostId: TARGET, status: "error", containerId: null, movedFromHostId: SOURCE, moveObjectName: "moves/x.tar", movedAt: new Date() }));

  await h.manager.move(ID, SOURCE);

  assert.deepEqual(h.repo.moveBacks, [{ toHostId: SOURCE, gatewayPort: 19001 }]);
  assert.deepEqual(h.source.exported, []);
  assert.deepEqual(h.target.exported, []);
  assert.deepEqual(h.storage.uploads, []);
  assert.equal(h.repo.instance.hostId, SOURCE);
  assert.equal(h.repo.instance.status, "error");
  assert.equal(h.repo.instance.movedFromHostId, null);
  assert.equal(h.repo.instance.moveObjectName, null);
  assert.ok(h.events.includes("move.rolled_back"));
});

test("the rollback removes whatever the failed target still holds before the row leaves it, and refuses when that host is unreachable", async () => {
  const stranded = () =>
    bot({ hostId: TARGET, status: "error", containerId: null, movedFromHostId: SOURCE, moveObjectName: "moves/x.tar", movedAt: new Date() });

  const h = harness(stranded(), { targetExisting: "tgt-9", targetVolumes: ["oc-4b86fc8b-ef1-state"] });
  await h.manager.move(ID, SOURCE);
  assert.deepEqual(h.target.removed, ["tgt-9"]);
  assert.deepEqual(h.target.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(h.repo.moveBacks.length, 1);
  assert.equal(h.repo.instance.hostId, SOURCE);

  const dark = harness(stranded(), { targetExisting: "tgt-9", targetReachable: false });
  await assert.rejects(() => dark.manager.move(ID, SOURCE), /unreachable/);
  assert.deepEqual(dark.target.removed, []);
  assert.deepEqual(dark.repo.moveBacks, []);
  assert.equal(dark.repo.instance.hostId, TARGET);
});

const RESUMED_OBJECT = `moves/${ID}/2026-09-16T00:00:00.000Z.tar`;

function movedMidBoot(): Instance {
  return bot({
    hostId: TARGET,
    status: "provisioning",
    containerId: "tgt-1",
    movedFromHostId: SOURCE,
    moveObjectName: RESUMED_OBJECT,
    movedAt: new Date(),
  });
}

test("resuming after a crash between import and start imports again into the never-started container, then finishes the move", async () => {
  const h = harness(movedMidBoot(), { targetExisting: "tgt-1", uploaded: [RESUMED_OBJECT] });

  await h.manager.resumeProvisioning(ID);

  assert.deepEqual(h.target.imported, ["tgt-1"]);
  assert.deepEqual(h.target.started, ["tgt-1"]);
  assert.ok(h.order.indexOf("imported") > h.order.indexOf("import:tgt-1"));
  assert.ok(h.order.indexOf("status:running") > h.order.indexOf("healthy:tgt-1"));
  assert.equal(h.repo.instance.status, "running");
  assert.equal(h.repo.instance.moveObjectName, null);
  assert.equal(h.repo.instance.moveImportedAt, null);
  assert.deepEqual(h.storage.deleted, [RESUMED_OBJECT]);
});

test("resuming after a crash between start and promotion: the archive is recorded as imported, so it is never written over the live volume, even after an image bump replaced the container", async () => {
  const imported = () => ({ ...movedMidBoot(), moveImportedAt: new Date() });

  const sameImage = harness(imported(), { targetExisting: "tgt-1", targetStartedAt: new Date(), uploaded: [RESUMED_OBJECT] });
  await sameImage.manager.resumeProvisioning(ID);
  assert.deepEqual(sameImage.target.imported, []);
  assert.deepEqual(sameImage.target.created, []);
  assert.equal(sameImage.repo.instance.status, "running");
  assert.equal(sameImage.repo.instance.moveObjectName, null);
  assert.deepEqual(sameImage.storage.deleted, [RESUMED_OBJECT]);

  const newImage = harness({ ...imported(), containerId: "tgt-old" }, {
    targetExisting: "tgt-old",
    targetStartedAt: new Date(),
    targetOnCurrentImage: false,
    uploaded: [RESUMED_OBJECT],
  });
  await newImage.manager.resumeProvisioning(ID);
  assert.deepEqual(newImage.target.removed, ["tgt-old"]);
  assert.deepEqual(newImage.target.created, ["tgt-1"]);
  assert.deepEqual(newImage.target.imported, []);
  assert.equal(newImage.repo.instance.status, "running");
});

test("a target container that started before the archive was imported stops the boot: the object and the rollback stay", async () => {
  const h = harness(movedMidBoot(), { targetExisting: "tgt-1", targetStartedAt: new Date(), uploaded: [RESUMED_OBJECT] });

  await assert.rejects(() => h.manager.resumeProvisioning(ID), /started before the archive/);

  assert.deepEqual(h.target.imported, []);
  assert.equal(h.repo.instance.status, "error");
  assert.equal(h.repo.instance.moveObjectName, RESUMED_OBJECT);
  assert.deepEqual(h.storage.deleted, []);
});

test("a completed move cannot be rolled back: an error row whose target already ran is refused before anything is removed", async () => {
  const h = harness(
    bot({ hostId: TARGET, status: "error", containerId: "tgt-1", movedFromHostId: SOURCE, moveObjectName: null, movedAt: new Date() }),
    { targetExisting: "tgt-1", targetVolumes: ["oc-4b86fc8b-ef1-state"] },
  );

  await assert.rejects(() => h.manager.move(ID, SOURCE), /completed; recreate the bot there first/);

  assert.deepEqual(h.target.removed, []);
  assert.deepEqual(h.target.removedVolumes, []);
  assert.deepEqual(h.repo.moveBacks, []);
  assert.equal(h.repo.instance.hostId, TARGET);
});

test("moving back within retention removes the container left on that host before its volume, as Docker requires", async () => {
  const h = harness(bot({ movedFromHostId: TARGET, movedAt: new Date() }), {
    targetExisting: "tgt-old",
    targetVolumes: ["oc-4b86fc8b-ef1-state"],
  });

  await h.manager.move(ID, TARGET);

  assert.deepEqual(h.target.removed, ["tgt-old"]);
  assert.deepEqual(h.target.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(h.repo.instance.hostId, TARGET);
  assert.equal(h.repo.instance.status, "running");
});

test("recreate refuses a row whose move never finished: booting an empty volume there would let the sweeper delete the real copy", async () => {
  const h = harness(
    bot({ hostId: TARGET, status: "error", containerId: null, movedFromHostId: SOURCE, moveObjectName: "moves/x.tar", movedAt: new Date() }),
  );

  await assert.rejects(() => h.manager.recreate(ID, "user-1"), /never finished; move the bot back/);

  assert.deepEqual(h.target.created, []);
  assert.deepEqual(h.target.started, []);
  assert.equal(h.repo.instance.status, "error");
});

test("the rollback refuses a target container that ran on the imported archive; one that ran without it wrote nothing worth keeping", async () => {
  const stranded = (moveImportedAt: Date | null) =>
    bot({ hostId: TARGET, status: "error", containerId: "tgt-1", movedFromHostId: SOURCE, moveObjectName: "moves/x.tar", movedAt: new Date(), moveImportedAt });
  const docker = { targetExisting: "tgt-1", targetStartedAt: new Date(), targetVolumes: ["oc-4b86fc8b-ef1-state"] };

  const ran = harness(stranded(new Date()), docker);
  await assert.rejects(() => ran.manager.move(ID, SOURCE), /target container ran/);
  assert.deepEqual(ran.target.removed, []);
  assert.deepEqual(ran.target.removedVolumes, []);
  assert.deepEqual(ran.repo.moveBacks, []);

  const empty = harness(stranded(null), docker);
  await empty.manager.move(ID, SOURCE);
  assert.deepEqual(empty.target.removed, ["tgt-1"]);
  assert.deepEqual(empty.target.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(empty.repo.instance.hostId, SOURCE);
});

test("a dry run never takes the may-have-flipped branch: a failed export with a database blip still restarts the bot", async () => {
  const h = harness(bot(), { exportError: new Error("archive failed"), readsFailAfterStop: true });

  await assert.rejects(() => h.manager.move(ID, SOURCE, { dryRun: true }), /archive failed/);

  assert.deepEqual(h.source.started, ["src-1"]);
  assert.equal(h.repo.instance.status, "running");
  assert.ok(h.events.includes("move.failed"));
});

test("a rollback has no dry run: the request is refused before the target is touched", async () => {
  const h = harness(
    bot({ hostId: TARGET, status: "error", containerId: null, movedFromHostId: SOURCE, moveObjectName: "moves/x.tar", movedAt: new Date() }),
    { targetExisting: "tgt-9", targetVolumes: ["oc-4b86fc8b-ef1-state"] },
  );

  await assert.rejects(() => h.manager.move(ID, SOURCE, { dryRun: true }), /rollback has no dry run/);

  assert.deepEqual(h.target.removed, []);
  assert.deepEqual(h.target.removedVolumes, []);
  assert.deepEqual(h.repo.moveBacks, []);
});

test("a dry run on the bot's own host is allowed while a previous move's volume is still retained elsewhere", async () => {
  const h = harness(bot({ movedFromHostId: TARGET, movedAt: new Date() }));

  await h.manager.move(ID, SOURCE, { dryRun: true });

  assert.deepEqual(h.source.started, ["src-1"]);
  assert.deepEqual(h.target.removedVolumes, []);
});

test("a failed target boot cleans the target before the failure event is written, so a failing event store cannot leave the container behind", async () => {
  const h = harness(movedMidBoot(), { targetExisting: "tgt-1", uploaded: [RESUMED_OBJECT], importError: new Error("import failed"), failEvent: "provision.failed" });

  await assert.rejects(() => h.manager.resumeProvisioning(ID), /provision.failed is down/);

  assert.deepEqual(h.target.removed, ["tgt-1"]);
  assert.deepEqual(h.target.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(h.repo.instance.status, "error");
});

test("a dry run may name the bot's own host: with one host it rehearses stop, export, upload and restart alone", async () => {
  const h = harness(bot());

  await h.manager.move(ID, SOURCE, { dryRun: true });

  assert.deepEqual(h.source.stopped, ["src-1"]);
  assert.equal(h.storage.uploads.length, 1);
  assert.deepEqual(h.storage.deleted, h.storage.uploads);
  assert.deepEqual(h.source.started, ["src-1"]);
  assert.deepEqual(h.source.removedVolumes, []);
  assert.equal(h.repo.instance.status, "running");
  assert.ok(h.events.includes("move.dry_run"));
});

test("a target container that vanished between create and import fails the boot instead of booting empty", async () => {
  const h = harness(movedMidBoot(), { targetVanishes: true, uploaded: [RESUMED_OBJECT] });

  await assert.rejects(() => h.manager.resumeProvisioning(ID), /vanished before the import/);

  assert.deepEqual(h.target.imported, []);
  assert.equal(h.repo.instance.status, "error");
  assert.equal(h.repo.instance.moveObjectName, RESUMED_OBJECT);
  assert.deepEqual(h.storage.deleted, []);
});

test("a flip whose commit acknowledgement was lost leaves the source stopped, keeps the object for the target and records the flip", async () => {
  const h = harness(bot(), { moveToAckLost: true });

  await assert.rejects(() => h.manager.move(ID, TARGET), /connection reset/);

  assert.equal(h.repo.instance.hostId, TARGET);
  assert.equal(h.repo.instance.status, "provisioning");
  assert.deepEqual(h.source.started, []);
  assert.deepEqual(h.storage.deleted, []);
  assert.deepEqual(h.target.created, []);
  assert.ok(h.events.includes("move.flipped"));
  assert.ok(!h.events.includes("move.failed"));
});

test("a bot moved while stopped lands stopped on the target: volume imported, nothing started, no promotion event", async () => {
  const h = harness(bot({ status: "stopped", stoppedAt: new Date("2026-09-01T00:00:00Z") }), { sourceRunning: false });

  await h.manager.move(ID, TARGET);

  assert.equal(h.repo.moves[0]?.keepStopped, true);
  assert.equal(h.repo.instance.stoppedAt?.toISOString(), "2026-09-01T00:00:00.000Z", "stopped since is kept");
  assert.deepEqual(h.target.imported, ["tgt-1"]);
  assert.deepEqual(h.target.started, []);
  assert.equal(h.repo.instance.hostId, TARGET);
  assert.equal(h.repo.instance.status, "stopped");
  assert.equal(h.repo.instance.moveObjectName, null);
  assert.ok(!h.events.includes("provision.running"));
  assert.ok(h.events.includes("move.completed"));
});

test("a dry run whose final running write is refused logs it instead of leaving a silent stopped row", async () => {
  const h = harness(bot(), { resumeCasFails: true });

  await h.manager.move(ID, SOURCE, { dryRun: true });

  assert.deepEqual(h.source.started, ["src-1"]);
  assert.ok(h.warnings.includes("source started but its row did not return to running"));
});

class FakeRepo {
  readonly moves: MoveToInput[] = [];
  readonly moveBacks: MoveBackInput[] = [];
  readonly portsByHost: Record<string, number[]> = { [SOURCE]: [19000], [TARGET]: [] };

  constructor(
    public instance: Instance,
    private readonly order: string[],
    private conflicts: number,
    private readonly ackLost: boolean,
  ) {}

  readsFailAfterStop = false;
  resumeCasFails = false;

  async findById(id: string): Promise<Instance | null> {
    if (this.readsFailAfterStop && this.order.includes("stop:src-1")) throw new Error("database blip");
    return id === this.instance.id ? this.instance : null;
  }

  async updateStatus(
    _id: string,
    status: InstanceStatus,
    options?: { expectedStatus?: InstanceStatus; errorMessage?: string },
  ): Promise<boolean> {
    if (options?.expectedStatus && options.expectedStatus !== this.instance.status) return false;
    if (this.resumeCasFails && status === "running" && options?.expectedStatus === "stopped") return false;
    this.order.push(`status:${status}`);
    this.instance = {
      ...this.instance,
      status,
      errorMessage: options?.errorMessage ?? this.instance.errorMessage,
      stoppedAt: status === "stopped" ? new Date() : this.instance.stoppedAt,
    };
    return true;
  }

  async updateContainerId(_id: string, containerId: string): Promise<void> {
    this.instance = { ...this.instance, containerId };
  }

  async getActiveGatewayPorts(hostId: string): Promise<number[]> {
    return this.portsByHost[hostId] ?? [];
  }

  async moveTo(_id: string, input: MoveToInput): Promise<boolean> {
    this.moves.push(input);
    if (this.conflicts > 0) {
      this.conflicts -= 1;
      // Like a create that took the port first: it is now visible to the allocator.
      this.portsByHost[input.toHostId]!.push(input.gatewayPort);
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    if (this.instance.status !== "stopped" || this.instance.hostId !== input.fromHostId) return false;
    this.order.push("moveTo");
    this.instance = {
      ...this.instance,
      hostId: input.toHostId,
      gatewayPort: input.gatewayPort,
      status: "provisioning",
      containerId: null,
      healthFailures: 0,
      errorMessage: null,
      movedFromHostId: input.fromHostId,
      moveObjectName: input.objectName,
      movedAt: new Date(),
      moveImportedAt: null,
      stoppedAt: input.keepStopped ? this.instance.stoppedAt : null,
    };
    if (this.ackLost) throw new Error("connection reset");
    return true;
  }

  async moveBack(_id: string, input: MoveBackInput): Promise<boolean> {
    this.moveBacks.push(input);
    if (this.instance.status !== "error" || this.instance.movedFromHostId !== input.toHostId || !this.instance.moveObjectName) {
      return false;
    }
    this.instance = {
      ...this.instance,
      hostId: input.toHostId,
      gatewayPort: input.gatewayPort,
      containerId: null,
      movedFromHostId: null,
      moveObjectName: null,
      movedAt: null,
      moveImportedAt: null,
    };
    return true;
  }

  async markMoveImported(): Promise<void> {
    this.order.push("imported");
    this.instance = { ...this.instance, moveImportedAt: new Date() };
  }

  async completeMove(_id: string, status: "running" | "stopped"): Promise<boolean> {
    if (this.instance.status !== "provisioning") return false;
    this.order.push(`status:${status}`);
    this.instance = { ...this.instance, status, moveObjectName: null, moveImportedAt: null };
    return true;
  }
}

class FakeRuntime {
  readonly stopped: string[] = [];
  readonly started: string[] = [];
  readonly removed: string[] = [];
  readonly created: string[] = [];
  readonly removedVolumes: string[] = [];
  readonly exported: string[] = [];
  readonly imported: string[] = [];
  readonly prepared: string[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];

  constructor(
    private readonly name: string,
    private readonly order: string[],
    private readonly options: {
      running: boolean;
      volumes: string[];
      existing?: string;
      existingStartedAt?: Date;
      existingOnCurrentImage?: boolean;
      vanishes?: boolean;
      exportError?: Error;
      importError?: Error;
    },
  ) {}

  private present(): string[] {
    return [this.options.existing, ...this.created]
      .filter((id): id is string => id !== undefined)
      .filter((id) => !this.removed.includes(id));
  }

  async ensureImagePresent(): Promise<void> {}

  async isRunning(containerId: string): Promise<boolean> {
    return this.options.running && !this.stopped.includes(containerId);
  }

  async stop(containerId: string): Promise<void> {
    this.order.push(`stop:${containerId}`);
    this.stopped.push(containerId);
  }

  async start(containerId: string): Promise<void> {
    this.order.push(`start:${containerId}`);
    this.started.push(containerId);
  }

  async remove(containerId: string): Promise<void> {
    this.order.push(`remove:${containerId}`);
    this.removed.push(containerId);
  }

  async create(_opts: ContainerCreateOptions): Promise<string> {
    const id = `${this.name}-${this.created.length + 1}`;
    this.order.push(`create:${id}`);
    this.created.push(id);
    return id;
  }

  async containerState(containerId: string): Promise<ContainerState | null> {
    if (this.options.vanishes || !this.present().includes(containerId)) return null;
    return {
      running: await this.isRunning(containerId),
      restarting: false,
      health: "healthy",
      startedAt: containerId === this.options.existing ? (this.options.existingStartedAt ?? null) : null,
    };
  }

  async findContainerByName(): Promise<string | null> {
    return this.present().at(-1) ?? null;
  }

  async waitForHealthy(containerId: string): Promise<boolean> {
    this.order.push(`healthy:${containerId}`);
    return true;
  }

  async hasVolume(name: string): Promise<boolean> {
    return this.options.volumes.includes(name) && !this.removedVolumes.includes(name);
  }

  async ensureVolumeExists(): Promise<void> {}

  // Like the daemon: `volume rm --force` still refuses a volume a container references.
  async removeVolume(name: string): Promise<void> {
    if (this.present().length > 0) throw new Error(`remove ${name}: volume is in use`);
    this.removedVolumes.push(name);
  }

  async getArchive(containerId: string, _path: string, signal?: AbortSignal): Promise<Readable> {
    this.signals.push(signal);
    this.order.push(`export:${containerId}`);
    this.exported.push(containerId);
    if (this.options.exportError) throw this.options.exportError;
    return Readable.from([Buffer.from("tar")]);
  }

  async putArchive(containerId: string, _path: string, archive: Readable, signal?: AbortSignal): Promise<void> {
    this.signals.push(signal);
    this.order.push(`import:${containerId}`);
    this.imported.push(containerId);
    archive.destroy();
    if (this.options.importError) throw this.options.importError;
  }

  adapter(): AgentRuntimeAdapter {
    const runtime = this;
    return {
      kind: "openclaw",
      image: "openclaw-image",
      internalPort: 18789,
      maxBackupBytes: 1024,
      containerName: (id) => `openclaw-${id.slice(0, 12)}`,
      stateVolumeName: (id) => `oc-${id.slice(0, 12)}-state`,
      buildContainerOptions: async () => ({}) as never,
      generateConfig: () => ({ configJson: "{}", dotEnv: "" }),
      writeConfig: async () => {},
      applyConfig: async () => "applied" as const,
      injectWhatsappSession: async () => {},
      exportState: async () => {
        throw new Error("not implemented");
      },
      restoreState: async () => {},
      exportVolume: (containerId, signal) => runtime.getArchive(containerId, "/home/node/.openclaw", signal),
      importVolume: (containerId, tar, signal) => runtime.putArchive(containerId, "/home/node", tar, signal),
      probeGateway: async () => ({ healthy: true, degraded: null }),
      probeWhatsapp: async () => "unknown" as const,
      logoutWhatsapp: async () => ({ unlinked: true, cleared: true }),
      readOwnerIds: async () => [],
      closeBrowserTabs: async () => ({ closed: 0, failed: 0 }),
      listWhatsappPairingRequests: async () => [],
      startWhatsappChannel: async () => ({ status: "started" as const }),
      sendWhatsappMessage: async () => true,
      prepareState: async (inst) => {
        runtime.prepared.push(inst.id);
      },
      seedWorkspace: async () => {},
      isOnCurrentImage: async (containerId) =>
        containerId !== runtime.options.existing || (runtime.options.existingOnCurrentImage ?? true),
      verify: async () => [],
    };
  }
}

class FakeStorage implements MoveStorage {
  readonly uploads: string[] = [];
  readonly deleted: string[] = [];

  constructor(
    private readonly order: string[],
    uploaded: string[] = [],
  ) {
    this.uploads.push(...uploaded);
  }

  async uploadObjectStream(input: { objectName: string; contentType: string; body: Readable }) {
    assert.equal(input.contentType, "application/x-tar");
    assert.match(input.objectName, new RegExp(`^moves/${ID}/\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z\\.tar$`));
    let size = 0;
    for await (const chunk of input.body) size += (chunk as Buffer).length;
    this.order.push("upload");
    this.uploads.push(input.objectName);
    return { contentLength: size };
  }

  async openObjectStream(objectName: string) {
    assert.ok(this.uploads.includes(objectName) && !this.deleted.includes(objectName), "object must exist to restore");
    return { body: Readable.from([Buffer.from("tar")]), contentLength: 3, contentType: "application/x-tar" };
  }

  async deleteObject(objectName: string): Promise<void> {
    this.order.push("delete");
    this.deleted.push(objectName);
  }

  async deleteObjectsWithPrefix(): Promise<void> {}
}

function harness(
  instance: Instance,
  options: {
    storage?: FakeStorage | null;
    uploaded?: string[];
    moveToConflicts?: number;
    moveToAckLost?: boolean;
    exportError?: Error;
    importError?: Error;
    sourceRunning?: boolean;
    targetVolumes?: string[];
    targetExisting?: string;
    targetStartedAt?: Date;
    targetOnCurrentImage?: boolean;
    targetVanishes?: boolean;
    targetReachable?: boolean;
    placementError?: Error;
    readsFailAfterStop?: boolean;
    resumeCasFails?: boolean;
    failEvent?: string;
  } = {},
) {
  const order: string[] = [];
  const events: string[] = [];
  const repo = new FakeRepo(instance, order, options.moveToConflicts ?? 0, options.moveToAckLost ?? false);
  repo.readsFailAfterStop = options.readsFailAfterStop ?? false;
  repo.resumeCasFails = options.resumeCasFails ?? false;
  const warnings: string[] = [];
  const source = new FakeRuntime("src", order, {
    running: options.sourceRunning ?? true,
    volumes: [],
    existing: "src-1",
    exportError: options.exportError,
  });
  const target = new FakeRuntime("tgt", order, {
    running: options.targetStartedAt !== undefined,
    volumes: options.targetVolumes ?? [],
    existing: options.targetExisting,
    existingStartedAt: options.targetStartedAt,
    existingOnCurrentImage: options.targetOnCurrentImage,
    vanishes: options.targetVanishes,
    importError: options.importError,
  });
  const storage = options.storage === undefined ? new FakeStorage(order, options.uploaded) : options.storage;
  const registryFor = (runtime: FakeRuntime) => ({ get: () => runtime.adapter() }) as unknown as AgentRuntimeRegistry;
  const hosts = twoHosts(
    { hostId: SOURCE, runtime: source as unknown as ContainerRuntime, adapters: registryFor(source) },
    {
      hostId: TARGET,
      runtime: target as unknown as ContainerRuntime,
      adapters: registryFor(target),
      gate: { check: async () => options.targetReachable ?? true },
    },
  );
  const portAllocator = {
    allocate: async (hostId: string) => {
      const used = new Set(await repo.getActiveGatewayPorts(hostId));
      for (let port = 19000; port < 19100; port++) if (!used.has(port)) return port;
      throw new Error("exhausted");
    },
  };
  const placement = {
    assertFits: async () => {
      if (options.placementError) throw options.placementError;
    },
  };
  const manager = new InstanceManager(
    repo as never,
    hosts,
    portAllocator as never,
    placement as never,
    { maxProvisionRetries: 3 } as AppConfig,
    {
      append: async (_id: string, type: string) => {
        if (type === options.failEvent) throw new Error(`${type} is down`);
        events.push(type);
      },
    } as never,
    { logoutWhatsapp: async () => {}, teardownSidecar: async () => {} } as never,
    { revoke: async () => {}, revokeKey: async () => {} } as never,
    { info: () => {}, warn: (_: unknown, msg: string) => void warnings.push(msg), error: () => {} } as unknown as FastifyBaseLogger,
    null,
    undefined,
    null,
    null,
    null,
    storage,
  );
  return { manager, repo, source, target, storage: storage ?? new FakeStorage([]), order, events, warnings };
}

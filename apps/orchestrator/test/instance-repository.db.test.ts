import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hosts, instances, user } from "@agent-forall/db";
import { InstanceRepository } from "../src/storage/instance-repository.js";
import { isUniqueViolation } from "../src/storage/pg-errors.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const USER = "ir-user";
const HOSTS = ["ir-a", "ir-b", "ir-c"];
const ON_A = "51111111-1111-4111-8111-111111111111";
const ON_B = "52222222-2222-4222-8222-222222222222";
const ON_C = "53333333-3333-4333-8333-333333333333";
const MOVER = "54444444-4444-4444-8444-444444444444";
const KEY = Buffer.alloc(32, 7);

let pool: Pool;
let db: NodePgDatabase<Record<string, never>>;

function fields(id: string, hostId: string, gatewayPort: number) {
  return {
    id,
    userId: USER,
    hostId,
    displayName: id.slice(0, 8),
    status: "running" as const,
    config: {
      displayName: id.slice(0, 8),
      provider: { name: "openai" as const, apiKey: "k", model: "gpt-5" },
      channels: [],
      resources: { memoryMb: 1024, cpuShares: 512 },
    },
    containerId: null,
    containerName: `openclaw-${id.slice(0, 8)}`,
    gatewayPort,
    gatewayToken: `gw-${id.slice(0, 8)}`,
    healthFailures: 0,
    errorMessage: null,
    stoppedAt: null,
    destroyedAt: null,
  };
}

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 2 });
  db = drizzle(pool);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  await db.delete(instances).where(inArray(instances.hostId, HOSTS));
  await db.execute(sql`delete from hosts where id in ('ir-a', 'ir-b', 'ir-c')`);
  await db.insert(user).values({ id: USER, email: "ir-user@example.com" }).onConflictDoNothing();
  await db.insert(hosts).values(HOSTS.map((id) => ({ id })));
  const managed = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  await managed.insert(fields(ON_A, "ir-a", 19100));
  await managed.insert(fields(ON_B, "ir-b", 19101));
});

after(async () => {
  await pool?.end();
});

test("constructor refuses an empty managed set", () => {
  assert.throws(() => new InstanceRepository({} as never, KEY, new Set()));
});

test("insert with a host outside the managed set is refused", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  await assert.rejects(repo.insert(fields(ON_C, "ir-c", 19102)), /not managed/);
  const rows = await db.execute(sql`select count(*)::int as count from instances where host_id = 'ir-c'`);
  assert.equal(rows.rows[0]?.count, 0);
});

test("getActiveGatewayPorts is per host: host a never sees host b's ports", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  assert.deepEqual(await repo.getActiveGatewayPorts("ir-a"), [19100]);
  assert.deepEqual(await repo.getActiveGatewayPorts("ir-b"), [19101]);
  assert.deepEqual(await repo.getActiveGatewayPorts("ir-c"), []);
});

test("reads cover every managed host and nothing outside the set", { skip }, async () => {
  const both = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  const onlyA = new InstanceRepository(db, KEY, new Set(["ir-a"]));

  assert.deepEqual((await both.findByUserId(USER)).map((i) => i.id).sort(), [ON_A, ON_B]);
  assert.deepEqual((await onlyA.findByUserId(USER)).map((i) => i.id), [ON_A]);
  assert.equal((await onlyA.findById(ON_B)), null);
  assert.equal((await both.findById(ON_B))?.hostId, "ir-b");
  assert.equal(await onlyA.updateStatus(ON_B, "stopped"), false);
  assert.equal((await both.findById(ON_B))?.status, "running");
});

test("findStalePairings returns only rows on the given hosts", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  await repo.updatePairing(ON_A, { pairingStatus: "awaiting_qr" });
  await repo.updatePairing(ON_B, { pairingStatus: "awaiting_qr" });
  // updated_at is stamped by a trigger, so staleness is measured with a small threshold after a wait that beats clock skew.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  assert.deepEqual((await repo.findStalePairings(1_000, ["ir-a"])).map((i) => i.id), [ON_A]);
  assert.deepEqual((await repo.findStalePairings(1_000, ["ir-a", "ir-b"])).map((i) => i.id).sort(), [ON_A, ON_B]);
  assert.deepEqual(await repo.findStalePairings(1_000, []), []);
  assert.deepEqual(await repo.findStalePairings(3_600_000, ["ir-a", "ir-b"]), [], "a fresh pairing is not stale");
  await repo.updatePairing(ON_A, { pairingStatus: "none" });
  await repo.updatePairing(ON_B, { pairingStatus: "none" });
});

test("moveTo flips a stopped row in one CAS write and refuses the wrong status, host or an unmanaged target", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  await repo.insert({ ...fields(MOVER, "ir-a", 19200), status: "stopped" });
  const move = { fromHostId: "ir-a", toHostId: "ir-b", gatewayPort: 19201, objectName: "moves/x.tar", keepStopped: false };

  await assert.rejects(repo.moveTo(MOVER, { ...move, toHostId: "ir-c" }), /not managed/);
  assert.equal(await repo.moveTo(MOVER, { ...move, fromHostId: "ir-b" }), false);
  await repo.updateStatus(MOVER, "running");
  assert.equal(await repo.moveTo(MOVER, move), false);
  await repo.updateStatus(MOVER, "stopped", { errorMessage: "old" });
  await repo.updateContainerId(MOVER, "src-1");

  assert.equal(await repo.moveTo(MOVER, move), true);
  const moved = await repo.findById(MOVER);
  assert.equal(moved?.hostId, "ir-b");
  assert.equal(moved?.gatewayPort, 19201);
  assert.equal(moved?.status, "provisioning");
  assert.equal(moved?.containerId, null);
  assert.equal(moved?.healthFailures, 0);
  assert.equal(moved?.errorMessage, null);
  assert.equal(moved?.movedFromHostId, "ir-a");
  assert.equal(moved?.moveObjectName, "moves/x.tar");
  assert.equal(moved?.stoppedAt, null, "a running bot's flip clears the stopped marker");
  assert.ok(moved?.movedAt instanceof Date);
  assert.deepEqual(await repo.getActiveGatewayPorts("ir-a"), [19100]);
});

test("a port already active on the target surfaces as a unique violation from moveTo", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  // Back on ir-a as if never moved; ON_B holds 19101 on ir-b.
  await db.execute(sql`update instances set host_id = 'ir-a', gateway_port = 19200, status = 'stopped', moved_from_host_id = null where id = ${MOVER}`);

  await assert.rejects(
    repo.moveTo(MOVER, { fromHostId: "ir-a", toHostId: "ir-b", gatewayPort: 19101, objectName: "moves/y.tar", keepStopped: false }),
    (err: unknown) => isUniqueViolation(err),
  );
  assert.equal((await repo.findById(MOVER))?.hostId, "ir-a");
});

test("moveBack returns an error row to the host that holds its volume and clears the move columns", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  assert.equal(await repo.moveTo(MOVER, { fromHostId: "ir-a", toHostId: "ir-b", gatewayPort: 19202, objectName: "moves/z.tar", keepStopped: false }), true);

  assert.equal(await repo.moveBack(MOVER, { toHostId: "ir-a", gatewayPort: 19203 }), false);
  await repo.updateStatus(MOVER, "error", { errorMessage: "boot failed" });
  assert.equal(await repo.moveBack(MOVER, { toHostId: "ir-b", gatewayPort: 19203 }), false);
  await assert.rejects(repo.moveBack(MOVER, { toHostId: "ir-c", gatewayPort: 19203 }), /not managed/);

  assert.equal(await repo.moveBack(MOVER, { toHostId: "ir-a", gatewayPort: 19203 }), true);
  const back = await repo.findById(MOVER);
  assert.equal(back?.hostId, "ir-a");
  assert.equal(back?.gatewayPort, 19203);
  assert.equal(back?.status, "error");
  assert.equal(back?.containerId, null);
  assert.equal(back?.movedFromHostId, null);
  assert.equal(back?.moveObjectName, null);
  assert.equal(back?.movedAt, null);
});

test("findMovedSourcesDue honors the cutoff; markMoveImported stamps the row; completeMove promotes and clears both markers in one write, after which moveBack is refused; clearMove drops the rest", { skip }, async () => {
  const repo = new InstanceRepository(db, KEY, new Set(["ir-a", "ir-b"]));
  await repo.updateStatus(MOVER, "stopped");
  assert.equal(await repo.moveTo(MOVER, { fromHostId: "ir-a", toHostId: "ir-b", gatewayPort: 19204, objectName: "moves/w.tar", keepStopped: true }), true);
  assert.equal((await repo.findById(MOVER))?.moveImportedAt, null);
  assert.ok((await repo.findById(MOVER))?.stoppedAt instanceof Date, "a stopped bot's flip keeps the marker");

  assert.deepEqual((await repo.findMovedSourcesDue(60_000)).map((i) => i.id), []);
  assert.deepEqual((await repo.findMovedSourcesDue(-60_000)).map((i) => i.id), [MOVER]);

  await repo.markMoveImported(MOVER);
  assert.ok((await repo.findById(MOVER))?.moveImportedAt instanceof Date);

  assert.equal(await repo.completeMove(MOVER, "stopped"), true);
  assert.equal(await repo.completeMove(MOVER, "running"), false);
  const kept = await repo.findById(MOVER);
  assert.equal(kept?.status, "stopped");
  assert.equal(kept?.moveObjectName, null);
  assert.equal(kept?.moveImportedAt, null);
  assert.equal(kept?.movedFromHostId, "ir-a");
  assert.ok(kept?.movedAt instanceof Date);

  await repo.updateStatus(MOVER, "error", { errorMessage: "later" });
  assert.equal(await repo.moveBack(MOVER, { toHostId: "ir-a", gatewayPort: 19205 }), false);

  await repo.markMoveImported(MOVER);
  await repo.clearMove(MOVER);
  const cleared = await repo.findById(MOVER);
  assert.equal(cleared?.movedFromHostId, null);
  assert.equal(cleared?.movedAt, null);
  assert.equal(cleared?.moveImportedAt, null);
  assert.deepEqual(await repo.findMovedSourcesDue(-60_000), []);
});

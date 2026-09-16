import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { HostRepository } from "../src/storage/host-repository.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

let pool: Pool;
let db: NodePgDatabase<Record<string, never>>;

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 2 });
  db = drizzle(pool);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  await db.execute(sql`delete from hosts where id = 'test-host'`);
});

after(async () => {
  await pool?.end();
});

test("ensure registers a host once and is a no-op afterwards", { skip }, async () => {
  const repo = new HostRepository(db);
  await repo.ensure("test-host");
  await repo.ensure("test-host");
  const rows = await db.execute(sql`select count(*)::int as count from hosts where id = 'test-host'`);
  assert.equal(rows.rows[0]?.count, 1);
});

test("register inserts an unknown host and re-registration updates the address but keeps created_at", { skip }, async () => {
  const repo = new HostRepository(db);
  await db.execute(sql`delete from hosts where id = 'test-worker'`);
  await repo.register("test-worker", "10.0.0.1");
  const first = (await db.execute(sql`select address, created_at, last_registered_at from hosts where id = 'test-worker'`)).rows[0];
  await repo.register("test-worker", "10.0.0.2");
  const second = (await db.execute(sql`select address, created_at, last_registered_at from hosts where id = 'test-worker'`)).rows[0];
  assert.equal(first?.address, "10.0.0.1");
  assert.equal(second?.address, "10.0.0.2");
  assert.equal(String(second?.created_at), String(first?.created_at));
  assert.ok(new Date(String(second?.last_registered_at)) >= new Date(String(first?.last_registered_at)));
});

test("findAll lists every host with its address, capacity and status", { skip }, async () => {
  const repo = new HostRepository(db);
  await db.execute(sql`delete from hosts where id in ('test-host', 'test-worker')`);
  await repo.ensure("test-host");
  await repo.register("test-worker", "10.0.0.3", 16_000);
  const rows = (await repo.findAll()).filter((row) => row.id.startsWith("test-"));
  assert.deepEqual(rows, [
    { id: "test-host", address: null, memoryMb: null, status: "active" },
    { id: "test-worker", address: "10.0.0.3", memoryMb: 16_000, status: "active" },
  ]);
});

test("setCapacity updates memory_mb in place; a registration without a figure keeps it", { skip }, async () => {
  const repo = new HostRepository(db);
  await db.execute(sql`delete from hosts where id in ('test-host', 'test-worker', 'test-absent')`);
  await repo.ensure("test-host");
  await repo.setCapacity("test-host", 32_089);
  await repo.setCapacity("test-absent", 1);
  await repo.register("test-worker", "10.0.0.3", 16_000);
  await repo.register("test-worker", "10.0.0.4");
  const rows = (await repo.findAll()).filter((row) => row.id.startsWith("test-"));
  assert.deepEqual(rows, [
    { id: "test-host", address: null, memoryMb: 32_089, status: "active" },
    { id: "test-worker", address: "10.0.0.4", memoryMb: 16_000, status: "active" },
  ]);
});

test("instances.host_id is declared ON DELETE RESTRICT", { skip }, async () => {
  const rows = await db.execute(sql`
    select delete_rule from information_schema.referential_constraints
    where constraint_name = 'instances_host_id_hosts_id_fk'
  `);
  assert.equal(rows.rows[0]?.delete_rule, "RESTRICT");
});

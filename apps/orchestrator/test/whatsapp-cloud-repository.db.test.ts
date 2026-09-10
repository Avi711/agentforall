import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { instances, user, whatsappCloudInbox, whatsappCloudNumbers } from "@agent-forall/db";
import { ConflictError } from "../src/domain/errors.js";
import { WhatsappCloudRepository } from "../src/storage/whatsapp-cloud-repository.js";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11); the SQL here never ran in unit tests.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const DAY = 24 * 60 * 60 * 1000;

let pool: Pool;
// Same shape main.ts hands the repository: no schema generic.
let db: NodePgDatabase<Record<string, never>>;
let repo: WhatsappCloudRepository;

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 5 });
  db = drizzle(pool);
  // The migrator's own ledger lives in the drizzle schema; a stale one would skip every migration.
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  await db.insert(user).values({ id: "u1", email: "u1@example.com" });
  for (const [id, status] of [
    [A, "running"],
    [B, "running"],
    [C, "destroyed"],
  ] as const) {
    await db.insert(instances).values({
      id,
      userId: "u1",
      hostId: "host",
      displayName: id.slice(0, 8),
      status,
      config: {},
      containerName: `openclaw-${id.slice(0, 8)}`,
      gatewayPort: 19000 + Number(id[0]),
      gatewayToken: `gw-${id.slice(0, 8)}`,
    });
  }
  repo = new WhatsappCloudRepository(db, Buffer.alloc(32, 7));
});

after(async () => {
  await pool?.end();
});

async function seedInbox(instanceId: string, wamid: string, at: Date, payload: unknown = null, extra: Partial<typeof whatsappCloudInbox.$inferInsert> = {}) {
  const rows = await db
    .insert(whatsappCloudInbox)
    .values({
      wamid,
      instanceId,
      waTimestamp: at,
      receivedAt: at,
      payload: payload ?? { from: "972501234567", profileName: "Dana", message: { type: "text", text: { body: wamid } } },
      ...extra,
    })
    .returning({ id: whatsappCloudInbox.id });
  return rows[0]!.id;
}

test("a number is claimed once, re-claimed by its own bot, refused to another, and freed when its bot is destroyed", { skip }, async () => {
  await repo.bindNumber({ phoneNumberId: "2000", instanceId: A, wabaId: "1000", pin: "111111" });
  await repo.bindNumber({ phoneNumberId: "2000", instanceId: A, wabaId: "1000", pin: "222222" });
  assert.deepEqual(await repo.findNumber("2000"), { phoneNumberId: "2000", instanceId: A, wabaId: "1000", pin: "222222" });
  await assert.rejects(repo.bindNumber({ phoneNumberId: "2000", instanceId: B, wabaId: "1000", pin: "333333" }), ConflictError);
  await assert.rejects(repo.bindNumber({ phoneNumberId: "2001", instanceId: A, wabaId: "1000", pin: "444444" }), ConflictError);

  await db.update(instances).set({ status: "destroyed" }).where(eq(instances.id, A));
  assert.equal((await repo.findNumber("2000"))?.instanceId, null);
  await repo.bindNumber({ phoneNumberId: "2000", instanceId: B, wabaId: "1000", pin: "333333" });
  assert.equal((await repo.findNumber("2000"))?.instanceId, B);
  await db.update(instances).set({ status: "running" }).where(eq(instances.id, A));

  await repo.releaseNumber(B);
  assert.equal((await repo.findNumber("2000"))?.instanceId, null);
  assert.equal((await repo.findNumber("2000"))?.pin, "333333");
});

test("leases are oldest first per bot, capped per bot, skip rows another connection holds, and come back after expiry", { skip }, async () => {
  const t0 = new Date("2026-09-10T10:00:00Z");
  const a1 = await seedInbox(A, "wamid.a1", new Date(t0.getTime() + 1000));
  const a2 = await seedInbox(A, "wamid.a2", new Date(t0.getTime() + 2000));
  const a3 = await seedInbox(A, "wamid.a3", new Date(t0.getTime() + 3000));
  const b1 = await seedInbox(B, "wamid.b1", t0);

  const first = await repo.leasePending([A, B], 2, 60_000);
  assert.equal(first.malformed, 0);
  assert.deepEqual(
    first.leased.map((l) => [l.instanceId, l.message.wamid]),
    [
      [B, "wamid.b1"],
      [A, "wamid.a1"],
      [A, "wamid.a2"],
    ],
  );
  assert.equal(first.leased[1]?.message.id, a1.toString());
  assert.deepEqual(first.leased[1]?.message.message, { type: "text", text: { body: "wamid.a1" } });

  const second = await repo.leasePending([A, B], 2, 60_000);
  assert.deepEqual(second.leased.map((l) => l.message.wamid), ["wamid.a3"]);

  assert.equal(await repo.ack(B, [a1]), 0);
  assert.equal(await repo.ack(A, [a1, a2]), 2);
  assert.equal(await repo.ack(A, [a1]), 0);

  await db.update(whatsappCloudInbox).set({ leasedUntil: new Date(Date.now() - 1000) }).where(inArray(whatsappCloudInbox.id, [a3, b1]));
  const other = await pool.connect();
  try {
    await other.query("begin");
    await other.query("select id from whatsapp_cloud_inbox where id = $1 for update", [b1.toString()]);
    const third = await repo.leasePending([A, B], 5, 60_000);
    assert.deepEqual(third.leased.map((l) => l.message.wamid), ["wamid.a3"]);
    await other.query("rollback");
  } finally {
    other.release();
  }
  const attempts = await db.select({ attempts: whatsappCloudInbox.attempts }).from(whatsappCloudInbox).where(eq(whatsappCloudInbox.id, a3));
  assert.equal(attempts[0]?.attempts, 2);
  assert.equal(await repo.ack(B, [b1]), 1);
});

test("a row whose payload is not a message is dropped instead of delivered", { skip }, async () => {
  const id = await seedInbox(A, "wamid.bad", new Date(), { unexpected: true });

  const result = await repo.leasePending([A], 5, 60_000);

  assert.equal(result.malformed, 1);
  assert.equal(result.leased.some((l) => l.message.wamid === "wamid.bad"), false);
  const row = await db.select({ droppedAt: whatsappCloudInbox.droppedAt, payload: whatsappCloudInbox.payload }).from(whatsappCloudInbox).where(eq(whatsappCloudInbox.id, id));
  assert.ok(row[0]?.droppedAt);
  assert.equal(row[0]?.payload, null);
});

test("the sweeper drops by age, retires old markers, reports a stale backlog and frees a destroyed bot's number", { skip }, async () => {
  const now = Date.now();
  await seedInbox(A, "wamid.old", new Date(now - 8 * DAY));
  const acked = await seedInbox(A, "wamid.acked", new Date(now - 9 * DAY), null, { ackedAt: new Date(now - 9 * DAY), payload: null });
  await seedInbox(B, "wamid.stale", new Date(now - 2 * 60 * 60 * 1000));
  await db.insert(whatsappCloudNumbers).values({ phoneNumberId: "9000", instanceId: C, wabaId: "1000", pinEncrypted: "x" });

  const result = await repo.sweep({
    dropBefore: new Date(now - 7 * DAY),
    deleteAckedBefore: new Date(now - 8 * DAY),
    deleteConversationsIdleBefore: new Date(now - 30 * DAY),
    deleteSendsBefore: new Date(now - 90 * DAY),
    backlogOlderThan: new Date(now - 60 * 60 * 1000),
  });

  assert.deepEqual(result.dropped.map((d) => [d.instanceId, d.wamid]), [[A, "wamid.old"]]);
  assert.equal(result.releasedNumbers, 1);
  assert.deepEqual(result.backlog.map((b) => b.instanceId).sort(), [A, B].sort());
  const stale = result.backlog.find((b) => b.instanceId === B);
  assert.equal(stale?.pending, 1);
  assert.ok(stale?.oldestReceivedAt instanceof Date);
  const gone = await db.select({ id: whatsappCloudInbox.id }).from(whatsappCloudInbox).where(eq(whatsappCloudInbox.id, acked));
  assert.equal(gone.length, 0);
  const number = await db.select({ instanceId: whatsappCloudNumbers.instanceId }).from(whatsappCloudNumbers).where(eq(whatsappCloudNumbers.phoneNumberId, "9000"));
  assert.equal(number[0]?.instanceId, null);
});

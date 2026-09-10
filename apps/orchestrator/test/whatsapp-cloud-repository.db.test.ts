import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { instances, user, whatsappCloudConversations, whatsappCloudInbox, whatsappCloudNumbers } from "@agent-forall/db";
import { ConflictError } from "../src/domain/errors.js";
import { isCustomerMessage, isOwnerEcho, isPartnerRemoved, type InboundMessage } from "../src/domain/whatsapp-cloud.js";
import { WhatsappCloudRepository, type LeasedMessage } from "../src/storage/whatsapp-cloud-repository.js";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11); the SQL here never ran in unit tests.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
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
    [D, "running"],
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

function customerOf(leased: LeasedMessage | undefined): InboundMessage {
  assert.ok(leased && isCustomerMessage(leased.item));
  return leased.item;
}

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
  assert.deepEqual(await repo.findNumber("2000"), { phoneNumberId: "2000", instanceId: A, wabaId: "1000", pin: "222222", appDataSynced: [] });
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
    first.leased.map((l) => [l.instanceId, l.item.wamid]),
    [
      [B, "wamid.b1"],
      [A, "wamid.a1"],
      [A, "wamid.a2"],
    ],
  );
  assert.equal(first.leased[1]?.item.id, a1.toString());
  assert.deepEqual(customerOf(first.leased[1]).message, { type: "text", text: { body: "wamid.a1" } });

  const second = await repo.leasePending([A, B], 2, 60_000);
  assert.deepEqual(second.leased.map((l) => l.item.wamid), ["wamid.a3"]);

  assert.equal(await repo.ack(B, [a1]), 0);
  assert.equal(await repo.ack(A, [a1, a2]), 2);
  assert.equal(await repo.ack(A, [a1]), 0);

  await db.update(whatsappCloudInbox).set({ leasedUntil: new Date(Date.now() - 1000) }).where(inArray(whatsappCloudInbox.id, [a3, b1]));
  const other = await pool.connect();
  try {
    await other.query("begin");
    await other.query("select id from whatsapp_cloud_inbox where id = $1 for update", [b1.toString()]);
    const third = await repo.leasePending([A, B], 5, 60_000);
    assert.deepEqual(third.leased.map((l) => l.item.wamid), ["wamid.a3"]);
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
  assert.equal(result.leased.some((l) => l.item.wamid === "wamid.bad"), false);
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

test("an owner-echo row is leased as an echo, in order with customer messages, never dropped as malformed", { skip }, async () => {
  const t0 = new Date("2026-09-11T10:00:00Z");
  await seedInbox(D, "wamid.d1", t0);
  await seedInbox(D, "wamid.d2", new Date(t0.getTime() + 1000), { kind: "owner_echo", to: "972501234567" });

  const result = await repo.leasePending([D], 5, 60_000);

  assert.equal(result.malformed, 0);
  assert.deepEqual(
    result.leased.map(({ item }) => (isOwnerEcho(item) ? `echo to ${item.to}` : item.wamid)),
    ["wamid.d1", "echo to 972501234567"],
  );
  await repo.ack(D, result.leased.map(({ item }) => BigInt(item.id)));
});

test("a coexistence number binds and reads back without a PIN", { skip }, async () => {
  await repo.bindNumber({ phoneNumberId: "2100", instanceId: D, wabaId: "1000", pin: null });

  assert.deepEqual(await repo.findNumber("2100"), { phoneNumberId: "2100", instanceId: D, wabaId: "1000", pin: null, appDataSynced: [] });
});

test("an app reply holds a customer for a day from that reply, a later reply extends it, and an older one never undoes the owner's own choice", { skip }, async () => {
  const t0 = new Date(Date.now() - 60_000);
  await db.insert(whatsappCloudConversations).values({
    instanceId: D,
    waId: "972500000001",
    profileName: "Dana",
    lastInboundAt: t0,
    mode: "bot",
    modeChangedAt: new Date(t0.getTime() - 60_000),
    updatedAt: t0,
  });

  assert.equal(await repo.holdForOwner(D, "972500000001", t0, DAY), true);
  const held = await repo.findConversation(D, "972500000001");
  assert.equal(held?.mode, "human");
  assert.equal(held?.heldUntil?.getTime(), t0.getTime() + DAY);
  assert.equal(held?.profileName, "Dana");
  assert.deepEqual(held?.lastInboundAt, t0);

  const t1 = new Date(t0.getTime() + 30_000);
  assert.equal(await repo.holdForOwner(D, "972500000001", t1, DAY), false);
  assert.equal((await repo.findConversation(D, "972500000001"))?.heldUntil?.getTime(), t1.getTime() + DAY);

  await repo.setMode(D, "972500000001", "bot");
  assert.equal(await repo.holdForOwner(D, "972500000001", t1, DAY), false);
  const back = await repo.findConversation(D, "972500000001");
  assert.equal(back?.mode, "bot");
  assert.equal(back?.heldUntil, null);
});

test("a hand-over the owner chose has no end, and an app reply neither ends nor times it", { skip }, async () => {
  await db.insert(whatsappCloudConversations).values({ instanceId: D, waId: "972500000003", mode: "bot", updatedAt: new Date() });
  await repo.setMode(D, "972500000003", "human");

  assert.equal(await repo.holdForOwner(D, "972500000003", new Date(), DAY), false);
  const row = await repo.findConversation(D, "972500000003");
  assert.equal(row?.mode, "human");
  assert.equal(row?.heldUntil, null);
});

test("app replies are applied and acked in one step, a new customer gets a held ledger row, and a reply older than the hold holds nothing", { skip }, async () => {
  const t0 = new Date(Date.now() - 60_000);
  const e1 = await seedInbox(D, "wamid.echo.10", t0, { kind: "owner_echo", to: "972500000004" });
  const e2 = await seedInbox(D, "wamid.echo.11", t0, { kind: "owner_echo", to: "972500000005" });

  const held = await repo.applyOwnerEchoes(D, [{ id: e1, to: "972500000004", at: t0 }, { id: e2, to: "972500000005", at: t0 }], DAY);

  assert.deepEqual([...held].sort(), ["972500000004", "972500000005"]);
  const rows = await db.select({ ackedAt: whatsappCloudInbox.ackedAt }).from(whatsappCloudInbox).where(inArray(whatsappCloudInbox.id, [e1, e2]));
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.ackedAt !== null), true);
  assert.equal((await repo.findConversation(D, "972500000005"))?.mode, "human");

  assert.equal(await repo.holdForOwner(D, "972500000006", new Date(Date.now() - 2 * DAY), DAY), false);
  assert.equal(await repo.findConversation(D, "972500000006"), null);
});

test("idle ledger rows go after the retention period whoever answers them", { skip }, async () => {
  const old = new Date(Date.now() - 31 * DAY);
  await db.insert(whatsappCloudConversations).values({ instanceId: D, waId: "972500000007", mode: "human", updatedAt: old });
  const far = new Date(Date.now() - 400 * DAY);

  await repo.sweep({ dropBefore: far, deleteAckedBefore: far, deleteConversationsIdleBefore: new Date(Date.now() - 30 * DAY), deleteSendsBefore: far, backlogOlderThan: far });

  assert.equal(await repo.findConversation(D, "972500000007"), null);
});

test("an owner reply written before the webhook created the customer's ledger row still holds them", { skip }, async () => {
  const replyAt = new Date(Date.now() - 5_000);
  await db.insert(whatsappCloudConversations).values({ instanceId: D, waId: "972500000008", lastInboundAt: new Date(), mode: "bot", updatedAt: new Date() });

  assert.equal(await repo.holdForOwner(D, "972500000008", replyAt, DAY), true);
  assert.equal((await repo.findConversation(D, "972500000008"))?.mode, "human");
});

test("a number remembers each sync Meta accepted until a new signup clears them", { skip }, async () => {
  await repo.markAppDataSynced("2100", "smb_app_state_sync", new Date());
  assert.deepEqual((await repo.findNumber("2100"))?.appDataSynced, ["smb_app_state_sync"]);
  await repo.markAppDataSynced("2100", "history", new Date());
  assert.deepEqual((await repo.findNumber("2100"))?.appDataSynced, ["smb_app_state_sync", "history"]);

  await repo.clearAppDataSync("2100");
  assert.deepEqual((await repo.findNumber("2100"))?.appDataSynced, []);
});

test("a disconnect notice is leased as one, never dropped as malformed", { skip }, async () => {
  const id = await seedInbox(D, "partner_removed:d:1", new Date(Date.now() - 1_000), { kind: "partner_removed", wabaId: "1000" });

  const result = await repo.leasePending([D], 50, 60_000);

  assert.equal(result.malformed, 0);
  const item = result.leased.find((leased) => leased.item.id === id.toString())?.item;
  assert.ok(item && isPartnerRemoved(item));
  assert.equal(item.wabaId, "1000");
  await repo.ack(D, result.leased.map((leased) => BigInt(leased.item.id)));
});

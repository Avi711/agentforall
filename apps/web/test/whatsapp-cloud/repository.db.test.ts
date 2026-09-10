import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbFromPool, instances, user, whatsappCloudConversations, whatsappCloudNumbers, type Database } from "@agent-forall/db";
import { WhatsappCloudRepository } from "../../src/lib/whatsapp-cloud/repository";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const A = "11111111-1111-4111-8111-111111111111";
const GONE = "33333333-3333-4333-8333-333333333333";
const RECEIVED = new Date("2026-09-10T08:00:00Z");

let pool: Pool;
let db: Database;
let repo: WhatsappCloudRepository;

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 5 });
  db = createDbFromPool(pool);
  // The migrator's own ledger lives in the drizzle schema; a stale one would skip every migration.
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)) });
  await db.insert(user).values({ id: "u1", email: "u1@example.com" });
  for (const [id, status] of [
    [A, "running"],
    [GONE, "destroyed"],
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
  await db.insert(whatsappCloudNumbers).values([
    { phoneNumberId: "2000", instanceId: A, wabaId: "1000", pinEncrypted: "x" },
    { phoneNumberId: "2001", instanceId: null, wabaId: "1000", pinEncrypted: "x" },
    { phoneNumberId: "2002", instanceId: GONE, wabaId: "1000", pinEncrypted: "x" },
  ]);
  repo = new WhatsappCloudRepository(db);
});

after(async () => {
  await pool?.end();
});

function row(wamid: string, waId: string, profileName: string | null, receivedAt = RECEIVED) {
  return {
    wamid,
    instanceId: A,
    waId,
    profileName,
    waTimestamp: new Date(receivedAt.getTime() - 5000),
    receivedAt,
    payload: { from: waId, profileName, message: { type: "text", text: { body: "hi" } } },
  };
}

test("only a live bot's number routes; a released number and a destroyed bot's number route nowhere", { skip }, async () => {
  assert.equal(await repo.findInstanceIdByPhoneNumberId("2000"), A);
  assert.equal(await repo.findInstanceIdByPhoneNumberId("2001"), null);
  assert.equal(await repo.findInstanceIdByPhoneNumberId("2002"), null);
  assert.equal(await repo.findInstanceIdByPhoneNumberId("nope"), null);
});

test("a batch is stored once, the ledger keeps the newest receipt and the known name, and one NOTIFY per bot fires on commit", { skip }, async () => {
  const listener = new Client({ connectionString: url });
  const notifications: string[] = [];
  await listener.connect();
  listener.on("notification", (msg) => notifications.push(`${msg.channel}:${msg.payload}`));
  await listener.query("listen whatsapp_cloud_inbox");
  try {
    const later = new Date(RECEIVED.getTime() + 60_000);
    const first = await repo.enqueue([row("wamid.1", "972501234567", "Dana"), row("wamid.2", "972501234567", null, later), row("wamid.3", "972509999999", null)]);
    assert.equal(first, 3);
    const again = await repo.enqueue([row("wamid.1", "972501234567", "Dana"), row("wamid.4", "972501234567", "Dana Levi")]);
    assert.equal(again, 1);

    const dana = await db
      .select()
      .from(whatsappCloudConversations)
      .where(eq(whatsappCloudConversations.waId, "972501234567"));
    assert.equal(dana[0]?.profileName, "Dana Levi");
    assert.equal(dana[0]?.lastInboundAt?.toISOString(), later.toISOString());
    assert.equal(dana[0]?.mode, "bot");

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(notifications, [`whatsapp_cloud_inbox:${A}`, `whatsapp_cloud_inbox:${A}`]);
  } finally {
    await listener.end();
  }
});

test("a human-mode conversation keeps its mode through new inbound messages", { skip }, async () => {
  await db.update(whatsappCloudConversations).set({ mode: "human" }).where(eq(whatsappCloudConversations.waId, "972509999999"));

  await repo.enqueue([row("wamid.5", "972509999999", "Guy")]);

  const guy = await db.select().from(whatsappCloudConversations).where(eq(whatsappCloudConversations.waId, "972509999999"));
  assert.equal(guy[0]?.mode, "human");
  assert.equal(guy[0]?.profileName, "Guy");
});

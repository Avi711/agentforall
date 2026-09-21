import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { account, createDbFromPool, rateLimit, user, type Database } from "@agent-forall/db";
import { AuthRepository } from "../../src/lib/auth/repository";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const HOUR = 60 * 60 * 1000;
const now = new Date();
const old = new Date(now.getTime() - 48 * HOUR);
const cutoff = new Date(now.getTime() - 24 * HOUR);
const hardCutoff = new Date(now.getTime() - 7 * 24 * HOUR);
const ancient = new Date(now.getTime() - 8 * 24 * HOUR);

let pool: Pool;
let db: Database;
let repo: AuthRepository;

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 5 });
  db = createDbFromPool(pool);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)) });
  repo = new AuthRepository(db);

  const rows: Array<{ id: string; verified: boolean; createdAt: Date; touchedAt: Date; providers: string[] }> = [
    { id: "stale-password", verified: false, createdAt: old, touchedAt: old, providers: ["credential"] },
    { id: "fresh-password", verified: false, createdAt: old, touchedAt: now, providers: ["credential"] },
    { id: "resent-link", verified: false, createdAt: old, touchedAt: old, providers: ["credential"] },
    { id: "squatter-renewing", verified: false, createdAt: ancient, touchedAt: now, providers: ["credential"] },
    { id: "verified-password", verified: true, createdAt: ancient, touchedAt: old, providers: ["credential"] },
    { id: "unverified-google-linked", verified: false, createdAt: ancient, touchedAt: old, providers: ["credential", "google"] },
    { id: "half-written", verified: false, createdAt: ancient, touchedAt: old, providers: [] },
  ];
  for (const row of rows) {
    await db.insert(user).values({
      id: row.id,
      email: `${row.id}@example.com`,
      name: "Typed Name",
      image: "https://evil.example/pixel.png",
      emailVerified: row.verified,
      createdAt: row.createdAt,
      updatedAt: row.touchedAt,
    });
    for (const providerId of row.providers) {
      await db.insert(account).values({ id: `${row.id}-${providerId}`, accountId: row.id, providerId, userId: row.id });
    }
  }
});

after(async () => {
  await pool?.end();
});

test("unconfirmed sign-ups without a social login go once no link was sent since the cutoff, or past the hard age cap", { skip }, async () => {
  await repo.touchUser("resent-link");

  const deleted = await repo.deleteUnverifiedPasswordSignUps(cutoff, hardCutoff);

  assert.equal(deleted, 3);
  const left = (await db.select({ id: user.id }).from(user)).map((r) => r.id).sort();
  assert.deepEqual(left, ["fresh-password", "resent-link", "unverified-google-linked", "verified-password"]);
  const orphanAccounts = await db.select({ id: account.id }).from(account).where(sql`${account.userId} = 'stale-password'`);
  assert.equal(orphanAccounts.length, 0);
});

test("claiming an unconfirmed account verifies it and drops the profile its signer-up typed", { skip }, async () => {
  await repo.claimAccount("fresh-password");

  const [row] = await db.select().from(user).where(sql`${user.id} = 'fresh-password'`);
  assert.equal(row?.emailVerified, true);
  assert.equal(row?.name, null);
  assert.equal(row?.image, null);
});

test("claiming an already confirmed account changes nothing", { skip }, async () => {
  await repo.claimAccount("verified-password");

  const [row] = await db.select().from(user).where(sql`${user.id} = 'verified-password'`);
  assert.equal(row?.name, "Typed Name");
  assert.equal(row?.image, "https://evil.example/pixel.png");
});

test("the hit counter counts within its window and restarts after it", { skip }, async () => {
  const key = "email:test";
  const t0 = 1_000_000;

  assert.equal(await repo.countHit(key, HOUR, t0), 1);
  assert.equal(await repo.countHit(key, HOUR, t0 + 1000), 2);
  assert.equal(await repo.countHit(key, HOUR, t0 + 2 * HOUR), 1);
  await db.delete(rateLimit).where(sql`${rateLimit.key} = ${key}`);
});

test("rate-limit rows are unique per key, and stale ones are trimmed", { skip }, async () => {
  await db.insert(rateLimit).values({ id: "r1", key: "127.0.0.1/sign-in/email", count: 1, lastRequest: Date.now() });
  await db.insert(rateLimit).values({ id: "r2", key: "127.0.0.2/sign-in/email", count: 1, lastRequest: old.getTime() });
  await assert.rejects(db.insert(rateLimit).values({ id: "r3", key: "127.0.0.1/sign-in/email", count: 1, lastRequest: 0 }));

  assert.equal(await repo.deleteRateLimitRowsBefore(cutoff.getTime()), 1);
  assert.deepEqual((await db.select({ id: rateLimit.id }).from(rateLimit)).map((r) => r.id), ["r1"]);
});

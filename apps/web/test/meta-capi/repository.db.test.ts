import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbFromPool, metaAttribution, user, type Database } from "@agent-forall/db";
import { MetaAttributionRepository } from "../../src/lib/meta-capi/repository";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const SIGN_UP = { fbp: "fb.1.1789990000000.111", fbc: "fb.1.1789990000000.IwAR2abc", clientIp: "1.1.1.1", userAgent: "phone", country: "il" };
const LATER = { fbp: null, fbc: null, clientIp: "2.2.2.2", userAgent: "laptop", country: null };

let pool: Pool;
let db: Database;
let repo: MetaAttributionRepository;

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 5 });
  db = createDbFromPool(pool);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)) });
  repo = new MetaAttributionRepository(db);
  await db.insert(user).values({ id: "u1", email: "dana@example.com", name: "Dana", emailVerified: true });
});

after(async () => {
  await pool?.end();
});

test("a later browser without Meta cookies keeps the click the sign-up brought, and updates the rest", { skip }, async () => {
  await repo.remember("u1", SIGN_UP);
  await repo.remember("u1", LATER);

  assert.deepEqual(await repo.findIdentity("u1"), {
    email: "dana@example.com",
    name: "Dana",
    browser: { fbp: SIGN_UP.fbp, fbc: SIGN_UP.fbc, clientIp: "2.2.2.2", userAgent: "laptop", country: "il" },
  });
});

test("a user with no stored browser still has an identity; an unknown user has none", { skip }, async () => {
  await db.insert(user).values({ id: "u2", email: "noa@example.com", name: null, emailVerified: true });

  assert.deepEqual(await repo.findIdentity("u2"), {
    email: "noa@example.com",
    name: null,
    browser: { fbp: null, fbc: null, clientIp: null, userAgent: null, country: null },
  });
  assert.equal(await repo.findIdentity("nobody"), null);
});

test("deleting the account deletes its stored browser", { skip }, async () => {
  await repo.remember("u2", SIGN_UP);
  await db.delete(user).where(eq(user.id, "u2"));

  assert.deepEqual(await db.select().from(metaAttribution).where(eq(metaAttribution.userId, "u2")), []);
});

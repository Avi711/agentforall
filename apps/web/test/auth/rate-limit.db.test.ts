import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDbFromPool, rateLimit, type Database } from "@agent-forall/db";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

let pool: Pool;
let db: Database;

before(async () => {
  if (!url) return;
  pool = new Pool({ connectionString: url, max: 5 });
  db = createDbFromPool(pool);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)) });
});

after(async () => {
  await pool?.end();
});

test("Better Auth keeps its rate-limit counters in our table and blocks the 4th sign-in within 10s", { skip }, async () => {
  const auth = betterAuth({
    secret: "test-secret-with-enough-entropy-000000",
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(db, { provider: "pg", usePlural: false }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for"] } },
  });

  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-vercel-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ email: "nobody@example.com", password: "a wrong password" }),
      }),
    );
    statuses.push(res.status);
  }

  assert.deepEqual(statuses, [401, 401, 401, 429]);
  const rows = await db.select({ key: rateLimit.key }).from(rateLimit);
  assert.equal(rows.length, 1);
  assert.match(rows[0]?.key ?? "", /203\.0\.113\.7/);
});

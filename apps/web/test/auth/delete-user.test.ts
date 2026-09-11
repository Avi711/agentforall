import { test } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError } from "better-auth/api";
import { deleteUserOptions, type AccountCleanup } from "../../src/lib/auth/delete-user";
import { PendingCheckoutError } from "../../src/lib/billing/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

function setup(cleanup: AccountCleanup) {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    secret: "test-secret-with-enough-entropy-000000",
    baseURL: "http://localhost:3000",
    database: memoryAdapter(db),
    // Only a quick way to get a session in tests; production signs in with Google.
    emailAndPassword: { enabled: true },
    user: { deleteUser: deleteUserOptions(cleanup) },
  });

  async function signIn(): Promise<Headers> {
    const { headers } = await auth.api.signUpEmail({
      body: { email: "owner@example.com", password: "a-long-password", name: "Owner" },
      returnHeaders: true,
    });
    const cookie = headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return new Headers({ cookie });
  }

  return { auth, db, signIn };
}

function recordingCleanup(overrides: Partial<AccountCleanup> = {}) {
  const calls: string[] = [];
  const cleanup: AccountCleanup = {
    cancelBilling: async (userId) => {
      calls.push(`billing:${userId}`);
    },
    deleteBots: async (userId) => {
      calls.push(`bots:${userId}`);
    },
    ...overrides,
  };
  return { cleanup, calls };
}

test("a fresh session deletes the account straight away, billing first, then the bots", async () => {
  const { cleanup, calls } = recordingCleanup();
  const { auth, db, signIn } = setup(cleanup);
  const headers = await signIn();
  const userId = String(db.user[0]?.id);

  const result = await auth.api.deleteUser({ headers, body: {} });

  assert.deepEqual(result, { success: true, message: "User deleted" });
  assert.deepEqual(calls, [`billing:${userId}`, `bots:${userId}`]);
  assert.equal(db.user.length, 0);
  assert.equal(db.session.length, 0);
});

test("a session older than a day must sign in again, and nothing is touched", async () => {
  const { cleanup, calls } = recordingCleanup();
  const { auth, db, signIn } = setup(cleanup);
  const headers = await signIn();
  for (const session of db.session) session.createdAt = new Date(Date.now() - 2 * DAY_MS);

  await assert.rejects(auth.api.deleteUser({ headers, body: {} }), (err: unknown) => {
    assert.ok(err instanceof APIError);
    assert.equal(err.body?.code, "SESSION_EXPIRED");
    return true;
  });

  assert.deepEqual(calls, []);
  assert.equal(db.user.length, 1);
});

test("a pending checkout blocks the deletion with a Hebrew conflict, and the bots stay", async () => {
  const { cleanup, calls } = recordingCleanup({
    cancelBilling: async () => {
      throw new PendingCheckoutError();
    },
  });
  const { auth, db, signIn } = setup(cleanup);
  const headers = await signIn();

  await assert.rejects(auth.api.deleteUser({ headers, body: {} }), (err: unknown) => {
    assert.ok(err instanceof APIError);
    assert.equal(err.status, "CONFLICT");
    assert.match(err.message, /תשלום/);
    return true;
  });

  assert.deepEqual(calls, []);
  assert.equal(db.user.length, 1);
});

test("a failed bot cleanup keeps the account and its session, so the user can retry", async () => {
  const { cleanup, calls } = recordingCleanup({
    deleteBots: async () => {
      throw new Error("orchestrator unavailable");
    },
  });
  const { auth, db, signIn } = setup(cleanup);
  const headers = await signIn();
  const userId = String(db.user[0]?.id);

  await assert.rejects(auth.api.deleteUser({ headers, body: {} }), /orchestrator unavailable/);

  assert.deepEqual(calls, [`billing:${userId}`]);
  assert.equal(db.user.length, 1);
  assert.equal(db.session.length, 1);
});

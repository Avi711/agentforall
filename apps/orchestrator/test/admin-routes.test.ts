import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { ConflictError } from "../src/domain/errors.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { adminRoutes } from "../src/routes/admin.js";

const ID = "4b86fc8b-ef19-496b-9591-583c72069443";

async function appWith(manager: Record<string, unknown>) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(adminRoutes, { prefix: "/api/v1/admin", overview: { listInstances: async () => [] } as never, manager: manager as never });
  return app;
}

test("the operator's recreate takes no body fields and answers 204", async () => {
  const calls: string[] = [];
  const app = await appWith({ recreateBySystem: async (id: string) => void calls.push(id) });

  assert.equal((await app.inject({ method: "POST", url: `/api/v1/admin/instances/${ID}/recreate` })).statusCode, 204);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/instances/not-a-uuid/recreate" })).statusCode, 400);
  assert.deepEqual(calls, [ID]);
});

test("verify returns the manager's report, and a bot under an operation is a 409", async () => {
  const report = { status: "running", image: "img", onCurrentImage: true, running: true, checks: [{ name: "plugins loaded", ok: true, detail: null }] };
  const ok = await appWith({ verify: async () => report });
  const res = await ok.inject({ method: "GET", url: `/api/v1/admin/instances/${ID}/verify` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), report);

  const busy = await appWith({
    verify: async () => {
      throw new ConflictError("the bot is under an operation");
    },
  });
  assert.equal((await busy.inject({ method: "GET", url: `/api/v1/admin/instances/${ID}/verify` })).statusCode, 409);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { HostNotAllowedError } from "../src/domain/errors.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { internalHostRoutes } from "../src/routes/hosts.js";
import type { HostRegistrar } from "../src/services/host-registrar.js";

type Call = [string, string, number | undefined];

async function appWith(calls: Call[]) {
  const registrar = {
    register: async (idToken: string, address: string, memoryMb?: number) => {
      if (idToken !== "good") throw new HostNotAllowedError();
      calls.push([idToken, address, memoryMb]);
    },
  } as unknown as HostRegistrar;
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(internalHostRoutes, { prefix: "/internal", registrar });
  return app;
}

async function post(app: Awaited<ReturnType<typeof appWith>>, token: string | null, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/internal/hosts/register",
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    payload: body,
  });
}

test("a verified worker with a private address gets 204", async () => {
  const calls: Call[] = [];
  const app = await appWith(calls);
  assert.equal((await post(app, "good", { address: "10.10.0.4" })).statusCode, 204);
  assert.deepEqual(calls, [["good", "10.10.0.4", undefined]]);
});

test("missing, oversized or refused tokens are 401 before the address is looked at", async () => {
  const calls: Call[] = [];
  const app = await appWith(calls);
  for (const token of [null, "x".repeat(4097)]) {
    const res = await post(app, token, { address: "10.10.0.4" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, "UNAUTHORIZED");
  }
  const refused = await post(app, "bad", { address: "10.10.0.4" });
  assert.equal(refused.statusCode, 401);
  assert.equal(refused.json().code, "HOST_NOT_ALLOWED");
  assert.deepEqual(calls, []);
});

test("only a private IPv4 address is accepted", async () => {
  const app = await appWith([]);
  for (const address of ["8.8.8.8", "172.32.0.1", "fd00::1", "worker-1", ""]) {
    assert.equal((await post(app, "good", { address })).statusCode, 400, address);
  }
  assert.equal((await post(app, "good", { address: "192.168.1.2", extra: 1 })).statusCode, 400);
});

test("memoryMb is optional and must be a positive integer within range", async () => {
  const calls: Call[] = [];
  const app = await appWith(calls);
  assert.equal((await post(app, "good", { address: "10.10.0.4", memoryMb: 32_089 })).statusCode, 204);
  assert.deepEqual(calls, [["good", "10.10.0.4", 32_089]]);
  for (const memoryMb of [0, -1, 1.5, "32089", 4_000_001, null]) {
    assert.equal((await post(app, "good", { address: "10.10.0.4", memoryMb })).statusCode, 400, String(memoryMb));
  }
  assert.equal(calls.length, 1);
});

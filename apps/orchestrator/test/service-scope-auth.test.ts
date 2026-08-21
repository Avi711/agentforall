import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createAuthHook } from "../src/middleware/auth.js";
import { AuthenticationError } from "../src/domain/errors.js";

const hook = createAuthHook({
  apiKeys: { "user-key": "user-1" },
  serviceTokens: ["svc-token"],
  hmacSecret: Buffer.from("secret"),
});
const reply = {} as FastifyReply;

function request(
  authorization: string,
  opts: { serviceScope?: boolean; actAs?: string } = {},
): FastifyRequest {
  return {
    headers: {
      authorization,
      ...(opts.actAs ? { "x-act-as-user": opts.actAs } : {}),
    },
    routeOptions: { config: { serviceScope: opts.serviceScope } },
  } as unknown as FastifyRequest;
}

test("service token on a service-scope route authenticates as the service", async () => {
  const req = request("Bearer svc-token", { serviceScope: true });
  await hook(req, reply);
  assert.equal(req.authenticatedUserId, "__service__");
});

test("service token on a user route still requires x-act-as-user", async () => {
  await assert.rejects(() => hook(request("Bearer svc-token"), reply), AuthenticationError);
  const req = request("Bearer svc-token", { actAs: "user-9" });
  await hook(req, reply);
  assert.equal(req.authenticatedUserId, "user-9");
});

test("per-user api keys are rejected on service-scope routes", async () => {
  await assert.rejects(
    () => hook(request("Bearer user-key", { serviceScope: true }), reply),
    AuthenticationError,
  );
  const req = request("Bearer user-key");
  await hook(req, reply);
  assert.equal(req.authenticatedUserId, "user-1");
});

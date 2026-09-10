import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { CatalogQuery, IntegrationConnectRequest } from "../src/domain/integrations.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { integrationsRoutes } from "../src/routes/integrations.js";
import type { IntegrationsManager } from "../src/services/integrations/manager.js";

async function appWith(queries: CatalogQuery[]) {
  const integrations = {
    catalog: async (query: CatalogQuery) => {
      queries.push(query);
      return { apps: [], total: 0 };
    },
  } as unknown as IntegrationsManager;
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(integrationsRoutes, { prefix: "/api/v1", integrations });
  return app;
}

test("catalog query: defaults, slug lists, and bounds are enforced at the route", async () => {
  const queries: CatalogQuery[] = [];
  const app = await appWith(queries);

  assert.equal((await app.inject({ url: "/api/v1/integrations/catalog" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/v1/integrations/catalog?q=mail&limit=5" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/v1/integrations/catalog?slugs=gmail,notion," })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/v1/integrations/catalog?slugs=" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/v1/integrations/catalog?offset=48" })).statusCode, 200);
  assert.deepEqual(queries, [
    { limit: 24, offset: 0 },
    { q: "mail", limit: 5, offset: 0 },
    { slugs: ["gmail", "notion"], limit: 24, offset: 0 },
    { slugs: [], limit: 24, offset: 0 },
    { limit: 24, offset: 48 },
  ]);

  for (const bad of ["limit=0", "limit=101", "offset=-1", "offset=10001", "offset=1.5", "slugs=gmail,../x", "q=" + "x".repeat(65), "nope=1"]) {
    const res = await app.inject({ url: `/api/v1/integrations/catalog?${bad}` });
    assert.equal(res.statusCode, 400, bad);
    assert.equal(res.json().code, "VALIDATION_ERROR");
  }
  assert.equal(queries.length, 5);
  await app.close();
});

const BOT = "11111111-1111-4111-8111-111111111111";
const RETURN_URL = "https://agentforall.co.il/app/bot/connections?connected=gmail";

async function accountsApp() {
  const connects: IntegrationConnectRequest[] = [];
  const renames: { ref: string; label: string }[] = [];
  const integrations = {
    connect: async (_id: string, _user: string, request: IntegrationConnectRequest) => {
      connects.push(request);
      return { url: "https://connect/x", ref: "ca_1" };
    },
    rename: async (_id: string, _user: string, ref: string, label: string) => {
      renames.push({ ref, label });
    },
  } as unknown as IntegrationsManager;
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(integrationsRoutes, { prefix: "/api/v1", integrations });
  return { app, connects, renames };
}

test("connect: the label is optional, and arrives trimmed, NFC-composed and free of direction marks", async () => {
  const { app, connects } = await accountsApp();
  const connect = (payload: unknown) =>
    app.inject({ method: "POST", url: `/api/v1/instances/${BOT}/integrations/gmail/connect`, payload: payload as object });

  assert.equal((await connect({ returnUrl: RETURN_URL })).statusCode, 201);
  assert.equal((await connect({ returnUrl: RETURN_URL, label: "  \u200Fעבודה\u200E " })).statusCode, 201);
  assert.equal((await connect({ returnUrl: RETURN_URL, label: "e\u0301cole" })).statusCode, 201);
  assert.equal((await connect({ returnUrl: RETURN_URL, label: "\u200Bwork\uFEFF" })).statusCode, 201);
  assert.equal((await connect({ returnUrl: RETURN_URL, label: "\u{1F469}\u200D\u{1F4BB}" })).statusCode, 201);
  assert.deepEqual(connects, [
    { app: "gmail", returnUrl: RETURN_URL, label: undefined },
    { app: "gmail", returnUrl: RETURN_URL, label: "עבודה" },
    { app: "gmail", returnUrl: RETURN_URL, label: "\u00E9cole" },
    { app: "gmail", returnUrl: RETURN_URL, label: "work" },
    { app: "gmail", returnUrl: RETURN_URL, label: "\u{1F469}\u200D\u{1F4BB}" },
  ]);

  const bad = [
    { returnUrl: RETURN_URL, label: "" },
    { returnUrl: RETURN_URL, label: "   " },
    { returnUrl: RETURN_URL, label: "\u200F" },
    { returnUrl: RETURN_URL, label: "\u200B\u2060" },
    { returnUrl: RETURN_URL, label: "x".repeat(41) },
    { returnUrl: RETURN_URL, label: "work\nhome" },
    { returnUrl: RETURN_URL, label: 7 },
    { returnUrl: RETURN_URL, extra: true },
  ];
  for (const payload of bad) {
    const res = await connect(payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(res.json().code, "VALIDATION_ERROR");
  }
  assert.equal(connects.length, 5);
  await app.close();
});

test("rename: a label is required and validated like connect's", async () => {
  const { app, renames } = await accountsApp();
  const rename = (payload: unknown) =>
    app.inject({ method: "PATCH", url: `/api/v1/instances/${BOT}/integrations/ca_9`, payload: payload as object });

  assert.equal((await rename({ label: " אישי " })).statusCode, 204);
  assert.deepEqual(renames, [{ ref: "ca_9", label: "אישי" }]);

  for (const payload of [{}, { label: null }, { label: "" }, { label: "x".repeat(41) }, { label: "a", extra: 1 }]) {
    assert.equal((await rename(payload)).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(renames.length, 1);
  await app.close();
});

test("catalog answers 503 FEATURE_UNAVAILABLE when no provider is configured", async () => {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(integrationsRoutes, { prefix: "/api/v1", integrations: null });
  const res = await app.inject({ url: "/api/v1/integrations/catalog" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().code, "FEATURE_UNAVAILABLE");
  await app.close();
});

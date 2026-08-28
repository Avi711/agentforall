import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { CatalogQuery } from "../src/domain/integrations.js";
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

test("catalog answers 503 FEATURE_UNAVAILABLE when no provider is configured", async () => {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(integrationsRoutes, { prefix: "/api/v1", integrations: null });
  const res = await app.inject({ url: "/api/v1/integrations/catalog" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().code, "FEATURE_UNAVAILABLE");
  await app.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURED_SLUGS } from "../../src/lib/integrations/catalog.he";
import { CATALOG_SEARCH_LIMIT } from "../../src/lib/integrations/schemas";
import type { CatalogApp, CatalogQuery } from "../../src/lib/orchestrator/types";
import { IntegrationsService, type IntegrationsPort } from "../../src/lib/integrations/service";

const app = (slug: string): CatalogApp => ({ slug, name: slug, logo: null, description: null, categories: [], noAuth: false });

function fakePort() {
  const calls: { connect?: { app: string; returnUrl: string }; disconnect?: string; catalog: CatalogQuery[] } = {
    catalog: [],
  };
  const port: IntegrationsPort = {
    listIntegrationCatalog: async (_u, query) => {
      calls.catalog.push(query);
      return query.slugs ? query.slugs.map(app) : [app("gmail"), app("zendesk")];
    },
    listIntegrations: async () => [],
    connectIntegration: async (_u, _b, app, returnUrl) => {
      calls.connect = { app, returnUrl };
      return { url: "https://connect.example/x", ref: "ref-1" };
    },
    disconnectIntegration: async (_u, _b, ref) => {
      calls.disconnect = ref;
    },
  };
  return { port, calls };
}

test("connect builds the return url from the app url, never from the browser", async () => {
  const { port, calls } = fakePort();
  const service = new IntegrationsService(port, "https://agentforall.co.il");

  const link = await service.connect("user-1", "bot-1", "gmail");

  assert.equal(link.url, "https://connect.example/x");
  assert.deepEqual(calls.connect, {
    app: "gmail",
    returnUrl: "https://agentforall.co.il/app/bot/connections?connected=gmail",
  });
});

test("return url survives an app url with a trailing path and encodes the slug", () => {
  const service = new IntegrationsService(fakePort().port, "http://localhost:3000");
  assert.equal(
    service.returnUrl("google_calendar"),
    "http://localhost:3000/app/bot/connections?connected=google_calendar",
  );
});

test("disconnect forwards the ref untouched", async () => {
  const { port, calls } = fakePort();
  await new IntegrationsService(port, "https://agentforall.co.il").disconnect("u", "b", "ca_9");
  assert.equal(calls.disconnect, "ca_9");
});

test("overview fetches featured slugs plus the first search page, never repeating a featured app", async () => {
  const { port, calls } = fakePort();
  const overview = await new IntegrationsService(port, "https://agentforall.co.il").overview("u", "b", null);

  assert.deepEqual(overview.featured.map((a) => a.slug), [...FEATURED_SLUGS]);
  assert.deepEqual(overview.popular.map((a) => a.slug), ["zendesk"]);
  assert.equal(overview.watched, null);
  assert.deepEqual(calls.catalog, [
    { slugs: [...FEATURED_SLUGS], limit: FEATURED_SLUGS.length },
    { limit: CATALOG_SEARCH_LIMIT },
  ]);
});

test("overview looks up a non-featured watched app for its label and keeps it out of the featured grid", async () => {
  const { port } = fakePort();
  const service = new IntegrationsService(port, "https://agentforall.co.il");

  const zendesk = await service.overview("u", "b", "zendesk");
  assert.equal(zendesk.watched?.slug, "zendesk");
  assert.equal(zendesk.featured.some((a) => a.slug === "zendesk"), false);

  const gmail = await service.overview("u", "b", "gmail");
  assert.equal(gmail.watched, null);
  assert.deepEqual(gmail.featured.map((a) => a.slug), [...FEATURED_SLUGS]);
});

test("search drops featured apps from the results", async () => {
  const { port, calls } = fakePort();
  const results = await new IntegrationsService(port, "https://agentforall.co.il").search("u", { q: "z", limit: 5 });
  assert.deepEqual(results.map((a) => a.slug), ["zendesk"]);
  assert.deepEqual(calls.catalog, [{ q: "z", limit: 5 }]);
});

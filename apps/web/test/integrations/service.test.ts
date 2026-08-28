import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURED_SLUGS } from "../../src/lib/integrations/catalog.he";
import { CATALOG_SEARCH_LIMIT, CATALOG_SLUGS_LIMIT } from "../../src/lib/integrations/schemas";
import type { CatalogApp, CatalogQuery, IntegrationConnection } from "../../src/lib/orchestrator/types";
import { IntegrationsService, type IntegrationsPort } from "../../src/lib/integrations/service";

const app = (slug: string): CatalogApp => ({ slug, name: slug, logo: null, description: null, categories: [], noAuth: false });

const connection = (slug: string, status: IntegrationConnection["status"] = "active"): IntegrationConnection => ({
  ref: `ca_${slug}`,
  app: slug,
  status,
  createdAt: null,
});

function fakePort(connections: IntegrationConnection[] = []) {
  const calls: { connect?: { app: string; returnUrl: string }; disconnect?: string; catalog: CatalogQuery[] } = {
    catalog: [],
  };
  const port: IntegrationsPort = {
    listIntegrationCatalog: async (_u, query) => {
      calls.catalog.push(query);
      const apps = query.slugs ? query.slugs.map(app) : [app("gmail"), app("zendesk")];
      return { apps, total: query.slugs ? apps.length : 1400 };
    },
    listIntegrations: async () => connections,
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

test("overview of a bot with no connections asks only for the featured tiles", async () => {
  const { port, calls } = fakePort();
  const overview = await new IntegrationsService(port, "https://agentforall.co.il").overview("u", "b", null);

  assert.deepEqual(overview.mine, []);
  assert.deepEqual(overview.featured.map((a) => a.slug), [...FEATURED_SLUGS]);
  assert.equal(overview.watched, null);
  assert.deepEqual(overview.browse, { apps: [app("gmail"), app("zendesk")], total: 1400 });
  assert.deepEqual(calls.catalog, [
    { slugs: [...FEATURED_SLUGS], limit: FEATURED_SLUGS.length },
    { limit: CATALOG_SEARCH_LIMIT, offset: 0 },
  ]);
});

test("overview resolves every connected app, featured or not, newest first", async () => {
  const { port, calls } = fakePort([connection("zendesk"), connection("gmail", "pending")]);
  const overview = await new IntegrationsService(port, "https://agentforall.co.il").overview("u", "b", null);

  assert.deepEqual(overview.mine.map((a) => a.slug), ["zendesk", "gmail"]);
  // Featured stays whole: the page decides which tile belongs to which section.
  assert.deepEqual(overview.featured.map((a) => a.slug), [...FEATURED_SLUGS]);
  assert.deepEqual(calls.catalog[0]?.slugs, ["zendesk", "gmail", ...FEATURED_SLUGS.filter((s) => s !== "gmail")]);
});

test("overview looks up the watched app for its label, featured or not", async () => {
  const service = new IntegrationsService(fakePort().port, "https://agentforall.co.il");
  assert.equal((await service.overview("u", "b", "zendesk")).watched?.slug, "zendesk");
  assert.equal((await service.overview("u", "b", "gmail")).watched?.slug, "gmail");
});

test("overview caps the slug lookup without dropping the apps the user asked about", async () => {
  const many = Array.from({ length: CATALOG_SLUGS_LIMIT }, (_, i) => connection(`app${i}`));
  const { port, calls } = fakePort(many);
  const overview = await new IntegrationsService(port, "https://agentforall.co.il").overview("u", "b", "watched_app");

  const slugs = calls.catalog[0]?.slugs ?? [];
  assert.equal(slugs.length, CATALOG_SLUGS_LIMIT);
  assert.equal(slugs[0], "watched_app");
  assert.equal(overview.watched?.slug, "watched_app");
  assert.equal(overview.mine.length, CATALOG_SLUGS_LIMIT - 1);
});

test("search spans the whole catalog, featured apps included", async () => {
  const { port, calls } = fakePort();
  const page = await new IntegrationsService(port, "https://agentforall.co.il").search("u", { q: "z", limit: 5, offset: 24 });
  assert.deepEqual(page.apps.map((a) => a.slug), ["gmail", "zendesk"]);
  assert.equal(page.total, 1400);
  assert.deepEqual(calls.catalog, [{ q: "z", limit: 5, offset: 24 }]);
});

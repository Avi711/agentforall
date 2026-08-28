import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BotIntegrationParamsSchema,
  CatalogSearchSchema,
  ConnectParamsSchema,
  ConnectedQuerySchema,
} from "../../src/lib/integrations/schemas";
import { FEATURED_APPS, featuredApp, searchFeatured } from "../../src/lib/integrations/catalog.he";

const id = "11111111-1111-4111-8111-111111111111";

test("connect params accept provider slugs and reject path tricks", () => {
  assert.equal(ConnectParamsSchema.safeParse({ id, ref: "google_calendar" }).success, true);
  assert.equal(ConnectParamsSchema.safeParse({ id, ref: "../etc" }).success, false);
  assert.equal(ConnectParamsSchema.safeParse({ id, ref: "Gmail" }).success, false);
  assert.equal(ConnectParamsSchema.safeParse({ id: "nope", ref: "gmail" }).success, false);
});

test("connection refs allow provider ids but nothing url-significant", () => {
  assert.equal(BotIntegrationParamsSchema.safeParse({ id, ref: "ca_AbC-123" }).success, true);
  assert.equal(BotIntegrationParamsSchema.safeParse({ id, ref: "a/b" }).success, false);
  assert.equal(BotIntegrationParamsSchema.safeParse({ id, ref: "" }).success, false);
});

test("the connected query is optional and slug-shaped", () => {
  assert.equal(ConnectedQuerySchema.safeParse(undefined).success, true);
  assert.equal(ConnectedQuerySchema.safeParse("gmail").success, true);
  assert.equal(ConnectedQuerySchema.safeParse("<script>").success, false);
});

test("featured apps are unique, slug-shaped, and looked up by slug", () => {
  const slugs = FEATURED_APPS.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9_-]+$/);
  assert.equal(featuredApp("gmail")?.nameHe, "Gmail");
  assert.equal(featuredApp("nothing"), undefined);
});

test("hebrew queries match the curated copy, since the provider catalog is english only", () => {
  assert.deepEqual(searchFeatured("יומן"), ["googlecalendar", "outlook"]);
  assert.deepEqual(searchFeatured(" מיילים "), ["gmail"]);
  assert.deepEqual(searchFeatured("notion"), ["notion"]);
  assert.deepEqual(searchFeatured(""), []);
  assert.deepEqual(searchFeatured("אין דבר כזה"), []);
});

test("catalog search trims, coerces the limit, and rejects oversized input", () => {
  assert.deepEqual(CatalogSearchSchema.parse({ q: "  mail ", limit: "5" }), { q: "mail", limit: 5, offset: 0 });
  assert.deepEqual(CatalogSearchSchema.parse({}), { limit: 24, offset: 0 });
  assert.deepEqual(CatalogSearchSchema.parse({ offset: "48" }), { limit: 24, offset: 48 });
  assert.equal(CatalogSearchSchema.safeParse({ offset: "-1" }).success, false);
  assert.equal(CatalogSearchSchema.safeParse({ offset: "10001" }).success, false);
  assert.equal(CatalogSearchSchema.safeParse({ limit: "0" }).success, false);
  assert.equal(CatalogSearchSchema.safeParse({ limit: "101" }).success, false);
  assert.equal(CatalogSearchSchema.safeParse({ q: "x".repeat(65) }).success, false);
});

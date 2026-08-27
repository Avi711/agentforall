import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogApp } from "../src/domain/integrations.js";
import { searchCatalog } from "../src/services/integrations/catalog-search.js";

const app = (slug: string, name: string, noAuth = false): CatalogApp => ({
  slug,
  name,
  logo: null,
  description: null,
  categories: [],
  noAuth,
});
const APPS = [app("gmail", "Gmail"), app("googlecalendar", "Google Calendar"), app("weather", "Weather", true), app("notion", "Notion")];

test("slug lookup keeps the caller's order, dedupes, drops unknown slugs, and honours the limit", () => {
  const lookup = (slugs: string[], limit: number) => searchCatalog(APPS, { slugs, limit }).map((a) => a.slug);
  assert.deepEqual(lookup(["notion", "missing", "gmail", "notion"], 10), ["notion", "gmail"]);
  assert.deepEqual(lookup(["notion", "gmail"], 1), ["notion"]);
  assert.deepEqual(lookup([], 10), []);
});

test("search is case-insensitive over name and slug, skips no-auth apps, and honours the limit", () => {
  assert.deepEqual(searchCatalog(APPS, { q: "GOOGLE", limit: 10 }).map((a) => a.slug), ["googlecalendar"]);
  assert.deepEqual(searchCatalog(APPS, { q: "weather", limit: 10 }), []);
  assert.deepEqual(searchCatalog(APPS, { limit: 2 }).map((a) => a.slug), ["gmail", "googlecalendar"]);
});

import type { CatalogApp, CatalogPage, CatalogQuery } from "../../domain/integrations.js";

// `slugs` is a lookup in the caller's order; `q` searches connectable apps in the provider's usage order.
export function searchCatalog(apps: readonly CatalogApp[], query: CatalogQuery): CatalogPage {
  const matches = query.slugs ? bySlugs(apps, query.slugs) : byName(apps, query.q);
  return { apps: matches.slice(query.offset, query.offset + query.limit), total: matches.length };
}

function bySlugs(apps: readonly CatalogApp[], slugs: readonly string[]): CatalogApp[] {
  const bySlug = new Map(apps.map((app) => [app.slug, app]));
  return [...new Set(slugs)].map((slug) => bySlug.get(slug)).filter((app): app is CatalogApp => app !== undefined);
}

function byName(apps: readonly CatalogApp[], q: string | undefined): CatalogApp[] {
  const needle = q?.trim().toLowerCase() ?? "";
  return apps.filter(
    (app) => !app.noAuth && (needle === "" || app.name.toLowerCase().includes(needle) || app.slug.includes(needle)),
  );
}

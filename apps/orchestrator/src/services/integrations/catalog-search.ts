import type { CatalogApp, CatalogQuery } from "../../domain/integrations.js";

// `slugs` is a lookup in the caller's order; `q` searches connectable apps in the provider's usage order.
export function searchCatalog(apps: readonly CatalogApp[], query: CatalogQuery): CatalogApp[] {
  if (query.slugs) {
    const bySlug = new Map(apps.map((app) => [app.slug, app]));
    return [...new Set(query.slugs)]
      .map((slug) => bySlug.get(slug))
      .filter((app): app is CatalogApp => app !== undefined)
      .slice(0, query.limit);
  }
  const needle = query.q?.trim().toLowerCase() ?? "";
  const matches = apps.filter(
    (app) => !app.noAuth && (needle === "" || app.name.toLowerCase().includes(needle) || app.slug.includes(needle)),
  );
  return matches.slice(0, query.limit);
}

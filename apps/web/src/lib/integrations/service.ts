import { OrchestratorError } from "@/lib/orchestrator/client";
import type { CatalogApp, CatalogPage, CatalogQuery, ConnectLink, IntegrationConnection } from "@/lib/orchestrator/types";
import { FEATURED_SLUGS, SHOWCASE_SLUGS } from "./catalog.he";
import { CONNECTIONS_PATH } from "./paths";
import { CATALOG_SEARCH_LIMIT, CATALOG_SLUGS_LIMIT, type CatalogSearch } from "./schemas";

// The orchestrator answers 503 FEATURE_UNAVAILABLE when no provider is configured.
export function isIntegrationsUnavailable(err: unknown): boolean {
  if (!(err instanceof OrchestratorError)) return false;
  const body = err.body;
  return typeof body === "object" && body !== null && (body as { code?: unknown }).code === "FEATURE_UNAVAILABLE";
}

export interface ConnectionsOverview {
  // Every app this bot has a connection for, in any state — newest first.
  mine: CatalogApp[];
  featured: CatalogApp[];
  // First page of the whole catalog; the browser pages through the rest.
  browse: CatalogPage;
  // The app named in `?connected=`; the page only needs its label.
  watched: CatalogApp | null;
  connections: IntegrationConnection[];
}

export interface IntegrationsPort {
  listIntegrationCatalog(userId: string, query: CatalogQuery): Promise<CatalogPage>;
  listIntegrations(userId: string, botId: string): Promise<IntegrationConnection[]>;
  connectIntegration(
    userId: string,
    botId: string,
    app: string,
    returnUrl: string,
  ): Promise<ConnectLink>;
  disconnectIntegration(userId: string, botId: string, ref: string): Promise<void>;
}

export class IntegrationsService {
  constructor(
    private readonly port: IntegrationsPort,
    private readonly appUrl: string,
  ) {}

  // Search and browse are the same paged query — an empty `q` is the whole catalog.
  search(userId: string, input: CatalogSearch): Promise<CatalogPage> {
    return this.port.listIntegrationCatalog(userId, input);
  }

  // A few real logos for the dashboard card, so "חיבורים" reads as apps rather than as settings.
  async showcase(userId: string): Promise<CatalogApp[]> {
    const page = await this.port.listIntegrationCatalog(userId, {
      slugs: [...SHOWCASE_SLUGS],
      limit: SHOWCASE_SLUGS.length,
    });
    return page.apps;
  }

  // Only what the page renders; the full catalog stays in the orchestrator and is searched there.
  async overview(userId: string, botId: string, watchApp: string | null): Promise<ConnectionsOverview> {
    const connections = await this.list(userId, botId);
    const mineSlugs = unique(connections.map((c) => c.app));
    // Named apps come first: the cap may only drop featured tiles, never one the user asked about.
    const slugs = unique([...(watchApp ? [watchApp] : []), ...mineSlugs, ...FEATURED_SLUGS]).slice(
      0,
      CATALOG_SLUGS_LIMIT,
    );
    const [named, browse] = await Promise.all([
      this.port.listIntegrationCatalog(userId, { slugs, limit: slugs.length }),
      this.search(userId, { limit: CATALOG_SEARCH_LIMIT, offset: 0 }),
    ]);
    const bySlug = new Map(named.apps.map((app) => [app.slug, app]));
    const pick = (wanted: readonly string[]): CatalogApp[] =>
      wanted.map((slug) => bySlug.get(slug)).filter((app): app is CatalogApp => app !== undefined);

    return {
      mine: pick(mineSlugs),
      featured: pick(FEATURED_SLUGS),
      browse,
      watched: (watchApp && bySlug.get(watchApp)) || null,
      connections,
    };
  }

  list(userId: string, botId: string): Promise<IntegrationConnection[]> {
    return this.port.listIntegrations(userId, botId);
  }

  // The return URL is ours to build: the browser never gets to choose where OAuth lands.
  connect(userId: string, botId: string, app: string): Promise<ConnectLink> {
    return this.port.connectIntegration(userId, botId, app, this.returnUrl(app));
  }

  disconnect(userId: string, botId: string, ref: string): Promise<void> {
    return this.port.disconnectIntegration(userId, botId, ref);
  }

  returnUrl(app: string): string {
    const url = new URL(CONNECTIONS_PATH, this.appUrl);
    url.searchParams.set("connected", app);
    return url.toString();
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

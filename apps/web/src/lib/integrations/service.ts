import { OrchestratorError } from "@/lib/orchestrator/client";
import type { CatalogApp, CatalogQuery, ConnectLink, IntegrationConnection } from "@/lib/orchestrator/types";
import { FEATURED_SLUGS } from "./catalog.he";
import { CONNECTIONS_PATH } from "./paths";
import { CATALOG_SEARCH_LIMIT, type CatalogSearch } from "./schemas";

// The orchestrator answers 503 FEATURE_UNAVAILABLE when no provider is configured.
export function isIntegrationsUnavailable(err: unknown): boolean {
  if (!(err instanceof OrchestratorError)) return false;
  const body = err.body;
  return typeof body === "object" && body !== null && (body as { code?: unknown }).code === "FEATURE_UNAVAILABLE";
}

export interface ConnectionsOverview {
  featured: CatalogApp[];
  popular: CatalogApp[];
  // The app named in `?connected=` when it is not featured; the page only needs its label.
  watched: CatalogApp | null;
  connections: IntegrationConnection[];
}

export interface IntegrationsPort {
  listIntegrationCatalog(userId: string, query: CatalogQuery): Promise<CatalogApp[]>;
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

  // Featured tiles are rendered once, at the top; searches and the popular page never repeat them.
  async search(userId: string, input: CatalogSearch): Promise<CatalogApp[]> {
    const apps = await this.port.listIntegrationCatalog(userId, input);
    return apps.filter((app) => !FEATURED_SLUGS.includes(app.slug));
  }

  // Only what the page renders; the full catalog stays in the orchestrator and is searched there.
  async overview(userId: string, botId: string, watchApp: string | null): Promise<ConnectionsOverview> {
    const extra = watchApp && !FEATURED_SLUGS.includes(watchApp) ? [watchApp] : [];
    const slugs = [...FEATURED_SLUGS, ...extra];
    const [named, popular, connections] = await Promise.all([
      this.port.listIntegrationCatalog(userId, { slugs, limit: slugs.length }),
      this.search(userId, { limit: CATALOG_SEARCH_LIMIT }),
      this.list(userId, botId),
    ]);
    return {
      featured: named.filter((app) => FEATURED_SLUGS.includes(app.slug)),
      popular,
      watched: named.find((app) => extra.includes(app.slug)) ?? null,
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

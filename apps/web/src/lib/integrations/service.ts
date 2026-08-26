import { OrchestratorError } from "@/lib/orchestrator/client";
import type { CatalogApp, ConnectLink, IntegrationConnection } from "@/lib/orchestrator/types";
import { CONNECTIONS_PATH } from "./paths";

// The orchestrator answers 503 FEATURE_UNAVAILABLE when no provider is configured.
export function isIntegrationsUnavailable(err: unknown): boolean {
  if (!(err instanceof OrchestratorError)) return false;
  const body = err.body;
  return typeof body === "object" && body !== null && (body as { code?: unknown }).code === "FEATURE_UNAVAILABLE";
}

export interface IntegrationsPort {
  listIntegrationCatalog(userId: string): Promise<CatalogApp[]>;
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

  catalog(userId: string): Promise<CatalogApp[]> {
    return this.port.listIntegrationCatalog(userId);
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

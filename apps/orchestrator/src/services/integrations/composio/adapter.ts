import type {
  CatalogApp,
  IntegrationConnection,
  IntegrationConnectionStatus,
} from "../../../domain/integrations.js";
import type {
  ConnectLink,
  ConnectLinkInput,
  CreateSessionInput,
  CreatedSession,
  IntegrationProvider,
} from "../provider.js";
import { SessionGoneError } from "../provider.js";
import { ComposioApiError, type ComposioClient, type ComposioToolkit } from "./client.js";

const STATUS_MAP: Record<string, IntegrationConnectionStatus> = {
  ACTIVE: "active",
  INITIATED: "pending",
  INITIALIZING: "pending",
  EXPIRED: "expired",
  FAILED: "failed",
  INACTIVE: "inactive",
};

export class ComposioIntegrationProvider implements IntegrationProvider {
  readonly name = "composio" as const;

  constructor(private readonly client: ComposioClient) {}

  async listCatalog(): Promise<CatalogApp[]> {
    const toolkits = await this.client.listToolkits();
    return toolkits.map(toCatalogApp);
  }

  async createSession(input: CreateSessionInput): Promise<CreatedSession> {
    const session = await this.client.createSession({
      userId: input.instanceId,
      callbackUrl: input.callbackUrl,
    });
    return { providerSessionId: session.session_id, upstreamMcpUrl: session.mcp.url };
  }

  async deleteSession(providerSessionId: string): Promise<void> {
    await this.client.deleteSession(providerSessionId);
  }

  async createConnectLink(input: ConnectLinkInput): Promise<ConnectLink> {
    try {
      const link = await this.client.createLink(input.providerSessionId, input.app, input.callbackUrl);
      return { url: link.redirect_url, ref: link.connected_account_id };
    } catch (err) {
      if (err instanceof ComposioApiError && err.status === 404) {
        throw new SessionGoneError(input.providerSessionId);
      }
      throw err;
    }
  }

  async listConnections(instanceId: string): Promise<IntegrationConnection[]> {
    const accounts = await this.client.listConnectedAccounts(instanceId);
    return accounts.map((account) => ({
      ref: account.id,
      app: account.toolkit?.slug ?? "unknown",
      status: STATUS_MAP[account.status.toUpperCase()] ?? "failed",
      createdAt: account.created_at ?? null,
    }));
  }

  async revokeConnection(ref: string): Promise<void> {
    await this.client.deleteConnectedAccount(ref);
  }

  upstreamHeaders(): Record<string, string> {
    return this.client.authHeaders();
  }
}

function toCatalogApp(toolkit: ComposioToolkit): CatalogApp {
  return {
    slug: toolkit.slug,
    name: toolkit.name,
    logo: toolkit.meta?.logo ?? null,
    description: toolkit.meta?.description ?? null,
    categories: (toolkit.meta?.categories ?? [])
      .map((c) => c.name ?? c.id)
      .filter((c): c is string => typeof c === "string"),
    noAuth: toolkit.no_auth ?? false,
  };
}

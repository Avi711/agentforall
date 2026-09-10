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
import { LabelConflictError, SessionGoneError } from "../provider.js";
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
      maxAccountsPerToolkit: input.maxAccountsPerApp,
    });
    return { providerSessionId: session.session_id, upstreamMcpUrl: session.mcp.url };
  }

  async deleteSession(providerSessionId: string): Promise<void> {
    await this.client.deleteSession(providerSessionId);
  }

  async allowMultipleAccounts(providerSessionId: string, maxAccountsPerApp: number): Promise<void> {
    await sessionCall(providerSessionId, () => this.client.enableMultiAccount(providerSessionId, maxAccountsPerApp));
  }

  async createConnectLink(input: ConnectLinkInput): Promise<ConnectLink> {
    const link = await sessionCall(input.providerSessionId, () =>
      aliasCall(() =>
        this.client.createLink({
          sessionId: input.providerSessionId,
          toolkit: input.app,
          callbackUrl: input.callbackUrl,
          alias: input.label,
        }),
      ),
    );
    return { url: link.redirect_url, ref: link.connected_account_id };
  }

  async listConnections(instanceId: string): Promise<IntegrationConnection[]> {
    const accounts = await this.client.listConnectedAccounts(instanceId);
    return accounts.map((account) => ({
      ref: account.id,
      app: account.toolkit?.slug ?? "unknown",
      status: STATUS_MAP[account.status.toUpperCase()] ?? "failed",
      // Composio clears an alias by storing "".
      label: account.alias?.trim() || null,
      createdAt: account.created_at ?? null,
    }));
  }

  async renameConnection(ref: string, label: string): Promise<void> {
    await aliasCall(() => this.client.setConnectedAccountAlias(ref, label));
  }

  async revokeConnection(ref: string): Promise<void> {
    await this.client.deleteConnectedAccount(ref);
  }

  upstreamHeaders(): Record<string, string> {
    return this.client.authHeaders();
  }
}

async function sessionCall<T>(providerSessionId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ComposioApiError && err.status === 404) throw new SessionGoneError(providerSessionId);
    throw err;
  }
}

// Composio answers 409 when the alias is already another of the user's accounts for the toolkit.
async function aliasCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ComposioApiError && err.status === 409) throw new LabelConflictError();
    throw err;
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

import type {
  CatalogApp,
  IntegrationConnection,
  IntegrationProviderName,
} from "../../domain/integrations.js";

export interface CreateSessionInput {
  instanceId: string;
  callbackUrl: string;
  maxAccountsPerApp: number;
}

export interface CreatedSession {
  providerSessionId: string;
  upstreamMcpUrl: string;
}

export interface ConnectLinkInput {
  providerSessionId: string;
  app: string;
  callbackUrl: string;
  label?: string;
}

export interface ConnectLink {
  url: string;
  ref: string;
}

// What the platform needs from a vendor; adapters map wire types to these at the edge.
export interface IntegrationProvider {
  readonly name: IntegrationProviderName;
  listCatalog(): Promise<CatalogApp[]>;
  createSession(input: CreateSessionInput): Promise<CreatedSession>;
  // A session already gone upstream is not an error.
  deleteSession(providerSessionId: string): Promise<void>;
  // Idempotent: sessions created before multi-account support would replace an app's account instead.
  allowMultipleAccounts(providerSessionId: string, maxAccountsPerApp: number): Promise<void>;
  // Both throw LabelConflictError when the vendor refuses the name as another account's.
  createConnectLink(input: ConnectLinkInput): Promise<ConnectLink>;
  listConnections(instanceId: string): Promise<IntegrationConnection[]>;
  renameConnection(ref: string, label: string): Promise<void>;
  // A connection already gone upstream is not an error.
  revokeConnection(ref: string): Promise<void>;
  // Headers the relay adds when forwarding to the upstream MCP endpoint.
  upstreamHeaders(): Record<string, string>;
}

// Upstream said the session no longer exists; callers may recreate once.
export class SessionGoneError extends Error {
  constructor(providerSessionId: string) {
    super(`integration session ${providerSessionId} no longer exists upstream`);
    this.name = "SessionGoneError";
  }
}

export class LabelConflictError extends Error {
  constructor() {
    super("the provider refused the account name as a duplicate");
    this.name = "LabelConflictError";
  }
}

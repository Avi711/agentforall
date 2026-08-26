import { randomUUID } from "node:crypto";
import type { CatalogApp, IntegrationConnection } from "../../../domain/integrations.js";
import type {
  ConnectLink,
  ConnectLinkInput,
  CreateSessionInput,
  CreatedSession,
  IntegrationProvider,
} from "../provider.js";
import { SessionGoneError } from "../provider.js";

const MOCK_CATALOG: CatalogApp[] = [
  { slug: "gmail", name: "Gmail", logo: null, description: "Read and send email", categories: ["email"], noAuth: false },
  { slug: "googlecalendar", name: "Google Calendar", logo: null, description: "Events and scheduling", categories: ["calendar"], noAuth: false },
  { slug: "notion", name: "Notion", logo: null, description: "Pages and databases", categories: ["productivity"], noAuth: false },
];

interface MockSession {
  instanceId: string;
  connections: IntegrationConnection[];
}

// Dev/test double: OAuth is a redirect straight back; upstream MCP is unreachable on purpose.
export class MockIntegrationProvider implements IntegrationProvider {
  readonly name = "mock" as const;
  private readonly sessions = new Map<string, MockSession>();

  async listCatalog(): Promise<CatalogApp[]> {
    return MOCK_CATALOG;
  }

  async createSession(input: CreateSessionInput): Promise<CreatedSession> {
    const providerSessionId = `mock-${randomUUID()}`;
    this.sessions.set(providerSessionId, { instanceId: input.instanceId, connections: [] });
    return { providerSessionId, upstreamMcpUrl: "http://127.0.0.1:9/mock-mcp" };
  }

  async deleteSession(providerSessionId: string): Promise<void> {
    this.sessions.delete(providerSessionId);
  }

  async createConnectLink(input: ConnectLinkInput): Promise<ConnectLink> {
    const session = this.sessions.get(input.providerSessionId);
    if (!session) throw new SessionGoneError(input.providerSessionId);
    const ref = `conn-${randomUUID()}`;
    session.connections.push({
      ref,
      app: input.app,
      status: "active",
      createdAt: new Date().toISOString(),
    });
    return { url: input.callbackUrl, ref };
  }

  async listConnections(instanceId: string): Promise<IntegrationConnection[]> {
    for (const session of this.sessions.values()) {
      if (session.instanceId === instanceId) return [...session.connections];
    }
    return [];
  }

  async revokeConnection(ref: string): Promise<void> {
    for (const session of this.sessions.values()) {
      session.connections = session.connections.filter((c) => c.ref !== ref);
    }
  }

  upstreamHeaders(): Record<string, string> {
    return {};
  }
}

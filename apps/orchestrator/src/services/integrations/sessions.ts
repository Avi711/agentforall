import type { FastifyBaseLogger } from "fastify";
import type { IntegrationSession } from "../../domain/integrations.js";
import type { Instance } from "../../domain/types.js";
import type { EventRepository } from "../../storage/event-repository.js";
import type { IntegrationSessionRepository } from "../../storage/integration-session-repository.js";
import type { IntegrationCleanup } from "../instance-manager.js";
import type { IntegrationProvider } from "./provider.js";

type SessionStore = Pick<IntegrationSessionRepository, "findByInstanceId" | "upsert" | "deleteByInstanceId">;
type EventLog = Pick<EventRepository, "append">;

// One provider session per bot; built before InstanceManager so destroy can revoke without a cycle.
export class IntegrationSessions implements IntegrationCleanup {
  constructor(
    private readonly store: SessionStore,
    private readonly provider: IntegrationProvider,
    private readonly eventLog: EventLog,
    private readonly log: FastifyBaseLogger,
  ) {}

  async find(instanceId: string): Promise<IntegrationSession | null> {
    return this.store.findByInstanceId(instanceId);
  }

  async ensure(instanceId: string, callbackUrl: string): Promise<IntegrationSession> {
    const existing = await this.store.findByInstanceId(instanceId);
    if (existing) return existing;
    return this.create(instanceId, callbackUrl);
  }

  // Upstream forgot the session: drop ours and start over.
  async recreate(instanceId: string, callbackUrl: string): Promise<IntegrationSession> {
    await this.store.deleteByInstanceId(instanceId);
    return this.create(instanceId, callbackUrl);
  }

  async resolveUpstream(instanceId: string): Promise<string | null> {
    const session = await this.store.findByInstanceId(instanceId);
    return session?.upstreamMcpUrl ?? null;
  }

  // Best effort, step by step: a provider outage must not block destroying the bot.
  async revokeAll(instance: Instance): Promise<void> {
    const session = await this.store.findByInstanceId(instance.id);
    if (!session) return;
    const warn = (step: string) => (err: unknown) =>
      this.log.warn({ instanceId: instance.id, step, err }, "integration revoke step failed");

    const connections = await this.provider.listConnections(instance.id).catch((err) => {
      warn("list")(err);
      return [];
    });
    for (const connection of connections) {
      await this.provider.revokeConnection(connection.ref).catch(warn(`revoke:${connection.app}`));
    }
    await this.provider.deleteSession(session.providerSessionId).catch(warn("session"));
    await this.store.deleteByInstanceId(instance.id);
    await this.eventLog.append(instance.id, "integration.revoked_all", {
      payload: { connections: connections.length },
    });
  }

  private async create(instanceId: string, callbackUrl: string): Promise<IntegrationSession> {
    const created = await this.provider.createSession({ instanceId, callbackUrl });
    const session = await this.store.upsert({
      instanceId,
      provider: this.provider.name,
      providerSessionId: created.providerSessionId,
      upstreamMcpUrl: created.upstreamMcpUrl,
    });
    await this.eventLog.append(instanceId, "integration.session_created", {
      payload: { provider: this.provider.name },
    });
    return session;
  }
}

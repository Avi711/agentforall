import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../config.js";
import {
  AuthenticationError,
  DomainError,
  FeatureUnavailableError,
  InvalidStateError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
} from "../../domain/errors.js";
import type { CatalogApp, IntegrationConnection } from "../../domain/integrations.js";
import type { Instance } from "../../domain/types.js";
import type { EventRepository } from "../../storage/event-repository.js";
import type { InstanceRepository } from "../../storage/instance-repository.js";
import type { InstanceManager } from "../instance-manager.js";
import { InstanceOperationLock } from "../instance-operation-lock.js";
import type { ConnectLink, IntegrationProvider } from "./provider.js";
import { SessionGoneError } from "./provider.js";
import type { IntegrationSessions } from "./sessions.js";

const CATALOG_TTL_MS = 60 * 60 * 1000;
const DASHBOARD_CONNECTIONS_PATH = "/app/bot/connections";

type Manager = Pick<InstanceManager, "get" | "updateConfig" | "restart">;
type Instances = Pick<InstanceRepository, "findById">;
type EventLog = Pick<EventRepository, "append">;
type Config = Pick<AppConfig, "orchestratorInternalUrl" | "dashboardOrigin">;

export interface RelayTarget {
  upstreamUrl: string;
  headers: Record<string, string>;
}

interface CatalogCache {
  apps: CatalogApp[];
  fetchedAt: number;
}

export class IntegrationsManager {
  private catalogCache: CatalogCache | null = null;
  private catalogInFlight: Promise<CatalogApp[]> | null = null;
  private readonly lock = new InstanceOperationLock();

  constructor(
    private readonly manager: Manager,
    private readonly instances: Instances,
    private readonly sessions: IntegrationSessions,
    private readonly provider: IntegrationProvider,
    private readonly eventLog: EventLog,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  // Serves stale on provider errors: a catalog hiccup should not blank the dashboard.
  async catalog(): Promise<CatalogApp[]> {
    const cached = this.catalogCache;
    if (cached && this.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.apps;
    if (this.catalogInFlight) return this.catalogInFlight;

    this.catalogInFlight = this.provider
      .listCatalog()
      .then((apps) => {
        this.catalogCache = { apps, fetchedAt: this.now() };
        return apps;
      })
      .catch((err: unknown) => {
        this.log.warn({ err }, "integration catalog refresh failed");
        if (!cached) throw new UpstreamUnavailableError("integrations");
        this.catalogCache = { apps: cached.apps, fetchedAt: this.now() };
        return cached.apps;
      })
      .finally(() => {
        this.catalogInFlight = null;
      });
    return this.catalogInFlight;
  }

  async list(instanceId: string, userId: string): Promise<IntegrationConnection[]> {
    await this.manager.get(instanceId, userId);
    const session = await this.sessions.find(instanceId);
    if (!session) return [];
    return this.upstream(() => this.provider.listConnections(instanceId));
  }

  async connect(
    instanceId: string,
    userId: string,
    app: string,
    returnUrl: string,
  ): Promise<ConnectLink> {
    const inst = await this.manager.get(instanceId, userId);
    this.assertReturnUrl(returnUrl);
    if (inst.runtimeKind !== "openclaw") throw new FeatureUnavailableError("integrations");

    return this.lock.run(instanceId, async () => {
      // Re-read under the lock: a concurrent connect may have bound the relay, or a destroy begun.
      const current = await this.manager.get(instanceId, userId);
      if (!isLive(current)) throw new InvalidStateError(current.status, "integration connect");

      const sessionCallback = new URL(DASHBOARD_CONNECTIONS_PATH, this.config.dashboardOrigin).toString();
      let session = await this.upstream(() => this.sessions.ensure(instanceId, sessionCallback));

      if (!current.config.integrations) {
        await this.manager.updateConfig(instanceId, userId, {
          integrations: {
            relayToken: randomBytes(32).toString("hex"),
            relayUrl: this.relayUrl(instanceId),
          },
        });
        // OpenClaw only wires new MCP servers at gateway startup; restart while the user is on the consent page.
        void this.manager.restart(instanceId, userId).catch((err) => {
          this.log.warn({ instanceId, err }, "restart after relay binding failed");
        });
      }

      const createLink = () =>
        this.upstream(() =>
          this.provider.createConnectLink({ providerSessionId: session.providerSessionId, app, callbackUrl: returnUrl }),
        );
      let link: ConnectLink;
      try {
        link = await createLink();
      } catch (err) {
        if (!(err instanceof SessionGoneError)) throw err;
        session = await this.upstream(() => this.sessions.recreate(instanceId, sessionCallback));
        link = await createLink();
      }

      await this.eventLog.append(instanceId, "integration.connect_requested", {
        actor: userId,
        payload: { app },
      });
      return link;
    });
  }

  async disconnect(instanceId: string, userId: string, ref: string): Promise<void> {
    // Ownership of `ref` is proven by it appearing in this bot's own connection list.
    const connection = (await this.list(instanceId, userId)).find((c) => c.ref === ref);
    if (!connection) throw new NotFoundError("integration connection", ref);
    await this.upstream(() => this.provider.revokeConnection(ref));
    await this.eventLog.append(instanceId, "integration.disconnected", {
      actor: userId,
      payload: { app: connection.app },
    });
  }

  // Bearer from the container is the only proof of identity; every failure looks the same.
  async resolveRelay(instanceId: string, bearer: string): Promise<RelayTarget> {
    const inst = await this.instances.findById(instanceId);
    if (!inst || !isLive(inst) || !inst.config.integrations) throw new AuthenticationError();
    if (!tokensMatch(bearer, inst.config.integrations.relayToken)) throw new AuthenticationError();
    const upstreamUrl = await this.sessions.resolveUpstream(instanceId);
    if (!upstreamUrl) throw new AuthenticationError();
    return { upstreamUrl, headers: this.provider.upstreamHeaders() };
  }

  private relayUrl(instanceId: string): string {
    return new URL(`/api/v1/mcp/${instanceId}`, this.config.orchestratorInternalUrl).toString();
  }

  private assertReturnUrl(returnUrl: string): void {
    let origin: string;
    try {
      origin = new URL(returnUrl).origin;
    } catch {
      throw new ValidationError("returnUrl must be an absolute URL");
    }
    if (origin !== new URL(this.config.dashboardOrigin).origin) {
      throw new ValidationError("returnUrl must be on the dashboard origin");
    }
  }

  // Provider failures are logged here and reach clients as a bare 502: no vendor detail leaves the server.
  private async upstream<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DomainError || err instanceof SessionGoneError) throw err;
      this.log.warn({ err }, "integration provider call failed");
      throw new UpstreamUnavailableError("integrations");
    }
  }
}

function isLive(inst: Instance): boolean {
  return inst.status !== "destroying" && inst.status !== "destroyed";
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

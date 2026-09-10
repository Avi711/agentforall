import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../config.js";
import {
  AccountLabelTakenError,
  AccountLimitReachedError,
  AuthenticationError,
  DomainError,
  FeatureUnavailableError,
  InvalidStateError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
} from "../../domain/errors.js";
import {
  INTEGRATION_MAX_ACCOUNTS_PER_APP,
  labelKey,
  type CatalogApp,
  type CatalogPage,
  type CatalogQuery,
  type IntegrationConnection,
  type IntegrationConnectRequest,
} from "../../domain/integrations.js";
import type { Instance } from "../../domain/types.js";
import type { EventRepository } from "../../storage/event-repository.js";
import type { InstanceRepository } from "../../storage/instance-repository.js";
import type { InstanceManager } from "../instance-manager.js";
import { InstanceOperationLock } from "../instance-operation-lock.js";
import { searchCatalog } from "./catalog-search.js";
import type { ConnectLink, IntegrationProvider } from "./provider.js";
import { LabelConflictError, SessionGoneError } from "./provider.js";
import type { IntegrationSessions } from "./sessions.js";

// Toolkits change on Composio's release cadence, not ours, so a day-old list is fine. What must not
// happen is a user waiting for the refill: it takes ~9s against Composio.
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
// From this age on, a read is answered from the list in hand and the refill runs behind it.
const CATALOG_REFRESH_AFTER_MS = 23 * 60 * 60 * 1000;
// A failed refresh must not freeze the list for another day, nor hammer a provider that is down.
const CATALOG_RETRY_AFTER_MS = 5 * 60 * 1000;
const DASHBOARD_CONNECTIONS_PATH = "/app/bot/connections";
const STALE_STATUSES = new Set<IntegrationConnection["status"]>(["expired", "failed"]);

type Manager = Pick<InstanceManager, "get">;
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

// `stuck` were superseded but their revoke failed.
interface ClearedAccounts {
  kept: IntegrationConnection[];
  stuck: IntegrationConnection[];
}

export class IntegrationsManager {
  // Only ever holds a list worth serving; a failed or empty answer never replaces it.
  private catalogCache: CatalogCache | null = null;
  // Every settled attempt, good or not, so a provider that is down is asked once per backoff rather
  // than once per read — including before the first list has ever landed.
  private catalogAttemptedAt: number | null = null;
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

  async catalog(query: CatalogQuery): Promise<CatalogPage> {
    return searchCatalog(await this.fullCatalog(), query);
  }

  // Fills the catalog before anyone asks for it; a cold fill costs ~9s of someone's page load.
  warmCatalog(): void {
    void this.fullCatalog().catch(() => {
      // fetchCatalog logged it. A catalog that can refill later must not stop the server booting.
    });
  }

  private async fullCatalog(): Promise<CatalogApp[]> {
    const cached = this.catalogCache;
    const now = this.now();
    if (cached && now - cached.fetchedAt < CATALOG_REFRESH_AFTER_MS) return cached.apps;

    const mayAttempt =
      this.catalogAttemptedAt === null || now - this.catalogAttemptedAt >= CATALOG_RETRY_AFTER_MS;

    // Still inside the day: answer from the list in hand and refill behind the answer.
    if (cached && now - cached.fetchedAt < CATALOG_TTL_MS) {
      // Unreachable rejection: with a list in hand fetchCatalog resolves to it, having logged.
      if (mayAttempt) void this.fetchCatalog().catch(() => {});
      return cached.apps;
    }
    if (!mayAttempt) {
      // A provider that is down must not put a ~33s retry budget on every read: past the TTL the
      // stale list is still all we have, and with nothing in hand the caller gets the failure now
      // rather than waiting for it.
      if (cached) return cached.apps;
      throw new UpstreamUnavailableError("integrations");
    }
    return this.fetchCatalog();
  }

  // The single fetch path: one flight at a time, every settled attempt recorded, and the last good
  // list left standing whenever an attempt brings back nothing usable.
  private fetchCatalog(): Promise<CatalogApp[]> {
    if (this.catalogInFlight) return this.catalogInFlight;

    this.catalogInFlight = this.provider
      .listCatalog()
      .then(
        (apps) => {
          // An empty list is a provider hiccup, not a catalog, so it never takes the day-long lease
          // a real one gets — at boot just as much as on a refresh.
          if (apps.length > 0) return apps;
          this.log.warn("integration catalog came back empty; not caching it");
          return null;
        },
        (err: unknown) => {
          this.log.warn({ err }, "integration catalog fetch failed");
          return null;
        },
      )
      .then((apps) => {
        const at = this.now();
        this.catalogAttemptedAt = at;
        if (apps) {
          this.catalogCache = { apps, fetchedAt: at };
          return apps;
        }
        const cached = this.catalogCache;
        if (!cached) throw new UpstreamUnavailableError("integrations");
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
    const connections = await this.upstream(() => this.provider.listConnections(instanceId));
    return newestFirst(connections);
  }

  async connect(instanceId: string, userId: string, request: IntegrationConnectRequest): Promise<ConnectLink> {
    const { app, returnUrl, label } = request;
    const inst = await this.manager.get(instanceId, userId);
    this.assertReturnUrl(returnUrl);
    if (inst.runtimeKind !== "openclaw") throw new FeatureUnavailableError("integrations");

    return this.lock.run(instanceId, async () => {
      // Re-read under the lock: a concurrent connect may have bound the relay, or a destroy begun.
      const current = await this.manager.get(instanceId, userId);
      if (!isLive(current)) throw new InvalidStateError(current.status, "integration connect");

      const sessionCallback = this.sessionCallback();
      const session = await this.upstream(() => this.sessions.ensure(instanceId, sessionCallback));

      // Bound at creation for every bot (and by recreate for older ones); a missing binding is a bug.
      if (!current.config.integrations) throw new FeatureUnavailableError("integrations");

      const cleared = await this.clearSupersededAttempts(instanceId, app, label);
      if (cleared) assertRoomForAccount(app, cleared, label);
      const addsAccount = cleared === null || cleared.kept.length + cleared.stuck.length > 0;

      const createLink = (providerSessionId: string) =>
        this.upstream(async () => {
          if (addsAccount) await this.provider.allowMultipleAccounts(providerSessionId, INTEGRATION_MAX_ACCOUNTS_PER_APP);
          return this.provider
            .createConnectLink({ providerSessionId, app, callbackUrl: returnUrl, label })
            .catch(labelTakenAs(app));
        });
      let link: ConnectLink;
      try {
        link = await createLink(session.providerSessionId);
      } catch (err) {
        if (!(err instanceof SessionGoneError)) throw err;
        const fresh = await this.upstream(() => this.sessions.recreate(instanceId, sessionCallback));
        // Gone again straight after a recreate is an outage, not something another recreate fixes.
        link = await createLink(fresh.providerSessionId).catch((retryErr: unknown) => {
          throw retryErr instanceof SessionGoneError ? new UpstreamUnavailableError("integrations") : retryErr;
        });
      }

      await this.eventLog.append(instanceId, "integration.connect_requested", {
        actor: userId,
        payload: { app },
      });
      return link;
    });
  }

  async rename(instanceId: string, userId: string, ref: string, label: string): Promise<void> {
    const inst = await this.manager.get(instanceId, userId);
    if (!isLive(inst)) throw new InvalidStateError(inst.status, "integration rename");
    await this.lock.run(instanceId, async () => {
      // Under the lock so a connect in flight cannot claim the same name between the check and the write.
      const connections = await this.upstream(() => this.provider.listConnections(instanceId));
      const target = connections.find((c) => c.ref === ref);
      if (!target) throw new NotFoundError("integration connection", ref);
      const taken = connections.some(
        (c) => c.ref !== ref && c.app === target.app && labelKey(c.label) === labelKey(label),
      );
      if (taken) throw new AccountLabelTakenError(target.app);
      await this.upstream(() => this.provider.renameConnection(ref, label).catch(labelTakenAs(target.app)));
      await this.eventLog.append(instanceId, "integration.renamed", {
        actor: userId,
        payload: { app: target.app },
      });
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
  // The provider session is created on the bot's first call, under the bot's lock so concurrent
  // first calls share one; a provider outage fails this call and the next one tries again.
  async resolveRelay(instanceId: string, bearer: string): Promise<RelayTarget> {
    const inst = await this.instances.findById(instanceId);
    if (!inst || !isLive(inst) || !inst.config.integrations) throw new AuthenticationError();
    if (!tokensMatch(bearer, inst.config.integrations.relayToken)) throw new AuthenticationError();
    const upstreamUrl =
      (await this.sessions.resolveUpstream(instanceId)) ??
      (await this.lock.run(instanceId, () =>
        this.upstream(() => this.sessions.ensure(instanceId, this.sessionCallback())),
      )).upstreamMcpUrl;
    return { upstreamUrl, headers: this.provider.upstreamHeaders() };
  }

  // Best effort: null (unreadable) never blocks a connect.
  private async clearSupersededAttempts(
    instanceId: string,
    app: string,
    label: string | undefined,
  ): Promise<ClearedAccounts | null> {
    let accounts: IntegrationConnection[];
    try {
      accounts = (await this.provider.listConnections(instanceId)).filter((c) => c.app === app);
    } catch (err) {
      this.log.warn({ instanceId, app, err }, "connection lookup before connect failed");
      return null;
    }
    const superseded = accounts.filter((c) => isSupersededBy(c, label));
    const results = await Promise.allSettled(superseded.map((c) => this.provider.revokeConnection(c.ref)));
    const stuck = superseded.filter((_, i) => {
      const result = results[i];
      if (result?.status !== "rejected") return false;
      this.log.warn({ instanceId, app, err: result.reason }, "superseded attempt revoke failed");
      return true;
    });
    return { kept: accounts.filter((c) => !superseded.includes(c)), stuck };
  }

  private sessionCallback(): string {
    return new URL(DASHBOARD_CONNECTIONS_PATH, this.config.dashboardOrigin).toString();
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

// A retry under the same name replaces its unfinished attempt; unnamed dead attempts are swept too.
function isSupersededBy(account: IntegrationConnection, label: string | undefined): boolean {
  if (account.status === "active") return false;
  if (labelKey(account.label) === labelKey(label)) return true;
  return account.label === null && STALE_STATUSES.has(account.status);
}

function assertRoomForAccount(app: string, { kept, stuck }: ClearedAccounts, label: string | undefined): void {
  const named = (accounts: IntegrationConnection[]) =>
    label !== undefined && accounts.some((c) => labelKey(c.label) === labelKey(label));
  if (kept.length >= INTEGRATION_MAX_ACCOUNTS_PER_APP) {
    throw new AccountLimitReachedError(app, INTEGRATION_MAX_ACCOUNTS_PER_APP);
  }
  if (named(kept)) throw new AccountLabelTakenError(app);
  // A replaced attempt that would not go away still holds its slot and name upstream: an outage, not the owner's doing.
  if (kept.length + stuck.length >= INTEGRATION_MAX_ACCOUNTS_PER_APP || named(stuck)) {
    throw new UpstreamUnavailableError("integrations");
  }
}

function labelTakenAs(app: string): (err: unknown) => never {
  return (err) => {
    throw err instanceof LabelConflictError ? new AccountLabelTakenError(app) : err;
  };
}

function isLive(inst: Instance): boolean {
  return inst.status !== "destroying" && inst.status !== "destroyed";
}

function newestFirst(connections: IntegrationConnection[]): IntegrationConnection[] {
  const key = (c: IntegrationConnection) => c.createdAt ?? "";
  return [...connections].sort((a, b) => (key(a) === key(b) ? 0 : key(a) > key(b) ? -1 : 1));
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

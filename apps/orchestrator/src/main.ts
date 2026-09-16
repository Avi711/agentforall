import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { InstanceOperationLock } from "./services/instance-operation-lock.js";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig, extractPairingConfig, type ControlPlaneTls } from "./config.js";
import { createApp } from "./server.js";
import { healthRoutes } from "./routes/health.js";
import { instanceRoutes } from "./routes/instances.js";
import { backupImportRoutes } from "./routes/backup-imports.js";
import { pairingRoutes, internalPairRoutes } from "./routes/pair.js";
import { telegramRoutes } from "./routes/telegram.js";
import { whatsappAccessRoutes } from "./routes/whatsapp-access.js";
import { WhatsappAccessManager } from "./services/whatsapp-access-manager.js";
import { ownerIdentityRoutes } from "./routes/owner-identity.js";
import { OwnerIdentityManager } from "./services/owner-identity-manager.js";
import { adminRoutes } from "./routes/admin.js";
import { AdminOverviewService } from "./services/admin-overview.js";
import { InstanceRepository } from "./storage/instance-repository.js";
import { HostRepository } from "./storage/host-repository.js";
import { HostRegistrar } from "./services/host-registrar.js";
import { HostReachability } from "./services/host-reachability.js";
import { StaticHostRuntimes, type HostCapacity, type HostRuntime } from "./services/host-runtimes.js";
import { createHostAttacher, createRemoteHost, createStubHost, type RemoteHostDeps } from "./services/remote-host.js";
import { createGoogleIdTokenVerifier } from "./services/google-identity.js";
import { internalHostRoutes } from "./routes/hosts.js";
import { HealthRepository } from "./storage/health-repository.js";
import { assertValidEncryptionKey } from "./services/crypto.js";
import type { ContainerRuntime } from "./services/container-runtime.js";
import { DockerContainerRuntime, createDockerClient, type DockerTls } from "./services/docker-container-runtime.js";
import { AgentRuntimeRegistry } from "./services/agent-runtime/registry.js";
import { OpenClawRuntimeAdapter } from "./services/agent-runtime/openclaw/adapter.js";
import { HermesRuntimeAdapter } from "./services/agent-runtime/hermes/adapter.js";
import { PortAllocator } from "./services/port-allocator.js";
import { Placement } from "./services/placement.js";
import { InstanceManager } from "./services/instance-manager.js";
import { HealthMonitor } from "./services/health-monitor.js";
import { AutoRestarter } from "./services/auto-restarter.js";
import { MemoryWatch } from "./services/memory-watch.js";
import { Reconciler } from "./services/reconciler.js";
import { EventRepository } from "./storage/event-repository.js";
import { HealthService } from "./services/health-service.js";
import { PairingManager } from "./services/pairing-manager.js";
import { PairingSessionRegistry } from "./services/pairing-session-registry.js";
import { PairingSidecarClient } from "./services/pairing-sidecar-client.js";
import { BackupTransferTokenService } from "./services/backup-transfer-token.js";
import { GcsBackupStorage } from "./services/gcs-backup-storage.js";
import { BackupImportManager } from "./services/backup-import-manager.js";
import { BackupExportManager } from "./services/backup-export-manager.js";
import { LiteLlmKeyManager } from "./services/litellm-key-manager.js";
import { TelegramBotApi } from "./services/telegram/bot-api.js";
import { ManagedBotLinker } from "./services/telegram/managed-bot-linker.js";
import { IntegrationSessionRepository } from "./storage/integration-session-repository.js";
import { createIntegrationProvider } from "./services/integrations/registry.js";
import { IntegrationSessions } from "./services/integrations/sessions.js";
import { IntegrationsManager } from "./services/integrations/manager.js";
import { createRelayFetch } from "./services/integrations/relay-fetch.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { mcpRelayRoutes } from "./routes/mcp-relay.js";
import { WhatsappCloudRepository } from "./storage/whatsapp-cloud-repository.js";
import { MetaGraphClient } from "./services/whatsapp-cloud/graph-client.js";
import { InboxDispatcher } from "./services/whatsapp-cloud/inbox-dispatcher.js";
import { WhatsappCloudInboxListener, canListenOn } from "./storage/whatsapp-cloud-listener.js";
import { WhatsappCloudManager } from "./services/whatsapp-cloud/manager.js";
import { whatsappCloudRoutes } from "./routes/whatsapp-cloud.js";
import { whatsappCloudRelayRoutes } from "./routes/whatsapp-cloud-relay.js";
import { MCP_RELAY_PATH, WHATSAPP_CLOUD_RELAY_PATH } from "./services/relay.js";
import type { IntegrationCleanup } from "./services/instance-manager.js";

const MAX_STARTUP_RETRIES = 10;
const STARTUP_BACKOFF_BASE_MS = 1000;

// Works in dev and in the built image.
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
);

async function waitForDependency(
  name: string,
  check: () => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_STARTUP_RETRIES; attempt++) {
    try {
      await check();
      return;
    } catch (err) {
      if (attempt === MAX_STARTUP_RETRIES) {
        throw new Error(
          `${name} not available after ${MAX_STARTUP_RETRIES} attempts: ${err}`,
        );
      }
      const delay = STARTUP_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(
        `${name} not ready (attempt ${attempt}/${MAX_STARTUP_RETRIES}), retrying in ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Pull failures are non-fatal because the image may already exist locally.
async function tryPullImage(
  runtime: ContainerRuntime,
  image: string,
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    await runtime.ensureImagePulled(image);
    log.info({ image }, "image ready");
  } catch (err) {
    log.warn({ image, err }, "image pull failed — may already exist locally");
  }
}

function readControlPlaneTls(paths: ControlPlaneTls): DockerTls {
  return { ca: readFileSync(paths.caPath), cert: readFileSync(paths.certPath), key: readFileSync(paths.keyPath) };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const encryptionKey = Buffer.from(config.encryptionKey, "hex");
  assertValidEncryptionKey(encryptionKey);
  const workerHostIds = [...config.managedHostIds].filter((hostId) => hostId !== config.orchestratorHostId);
  const controlPlaneTls = config.controlPlaneTls ? readControlPlaneTls(config.controlPlaneTls) : null;
  if (workerHostIds.length > 0 && !controlPlaneTls) {
    throw new Error(
      `WORKER_INSTANCE_IDS names remote hosts (${workerHostIds.join(", ")}) but CONTROL_PLANE_CA_PATH / ORCHESTRATOR_CLIENT_CERT_PATH / ORCHESTRATOR_CLIENT_KEY_PATH are unset`,
    );
  }

  const app = await createApp(config, encryptionKey);
  const log = app.log;

  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  const healthRepo = new HealthRepository(pool);
  await waitForDependency("database", async () => {
    await healthRepo.ping();
  });
  log.info("database connected");

  const db = drizzle(pool);
  if (config.runMigrationsOnStartup) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    log.info({ migrationsDir: MIGRATIONS_DIR }, "migrations applied");
  } else {
    log.info("startup migrations disabled");
  }

  const hostRepo = new HostRepository(db);
  for (const hostId of config.managedHostIds) await hostRepo.ensure(hostId);
  // The orchestrator sees the VM's RAM; workers report theirs at registration.
  await hostRepo.setCapacity(config.orchestratorHostId, Math.floor(totalmem() / 1024 / 1024));
  const repo = new InstanceRepository(db, encryptionKey, config.managedHostIds);
  log.info({ hostIds: [...config.managedHostIds] }, "hosts registered, queries scoped to them");
  const eventLog = new EventRepository(db);

  const runtime: ContainerRuntime = new DockerContainerRuntime(createDockerClient(config), config.dockerNetwork, log);

  await waitForDependency("docker", async () => {
    await runtime.ping();
  });
  log.info("docker connected");

  await runtime.ensureNetworkExists();
  const gate = new HostReachability(config.orchestratorHostId, runtime, log);

  const adaptersFor = (hostRuntime: ContainerRuntime): AgentRuntimeRegistry =>
    new AgentRuntimeRegistry([
      new OpenClawRuntimeAdapter(hostRuntime, config.agentRuntimeImage, config.orchestratorInternalUrl),
      new HermesRuntimeAdapter(hostRuntime, config.hermesRuntimeImage),
    ]);
  const runtimeAdapters = adaptersFor(runtime);
  const hostRows = new Map((await hostRepo.findAll()).map((row) => [row.id, row]));
  const capacityOf = (hostId: string): HostCapacity => {
    const row = hostRows.get(hostId);
    return { capacityMb: row?.memoryMb ?? null, status: row?.status ?? "active" };
  };
  const localHost: HostRuntime = {
    hostId: config.orchestratorHostId,
    address: null,
    ...capacityOf(config.orchestratorHostId),
    restartPolicy: "unless-stopped",
    dockerNetwork: config.useDockerNetwork,
    runtime,
    adapters: runtimeAdapters,
    gate,
  };
  const remoteDeps: RemoteHostDeps | null = controlPlaneTls
    ? { tls: controlPlaneTls, adaptersFor, networkName: config.dockerNetwork, logger: log }
    : null;
  // A worker without a registered address is a stub until it registers.
  const workerHosts = workerHostIds.map((hostId) => {
    const address = hostRows.get(hostId)?.address;
    return remoteDeps && address
      ? createRemoteHost(hostId, address, remoteDeps, capacityOf(hostId))
      : createStubHost(hostId, { adaptersFor }, capacityOf(hostId));
  });
  const hosts = new StaticHostRuntimes([localHost, ...workerHosts]);
  log.info(
    {
      hosts: hosts.all().map((host) => ({ hostId: host.hostId, address: host.address, capacityMb: host.capacityMb, status: host.status })),
    },
    "hosts attached",
  );
  const memoryWatch = new MemoryWatch(repo, hosts, log, {
    intervalMs: config.memoryWatchIntervalMs,
    warnFraction: config.memoryWatchWarnFraction,
  });
  const placement = new Placement(
    hosts,
    memoryWatch,
    { overcommit: config.placementOvercommit, reserveMb: config.hostReserveMb },
    log,
  );

  if (config.pullImagesOnStartup) {
    await tryPullImage(runtime, runtimeAdapters.get(config.agentRuntimeKind).image, log);
    await tryPullImage(runtime, config.pairingImage, log);
  } else {
    log.info("startup image pull disabled");
  }

  const pairingConfig = extractPairingConfig(config);
  const pairingSessions = new PairingSessionRegistry();
  const pairingSidecarClient = new PairingSidecarClient(
    pairingSessions,
    pairingConfig,
    log,
  );
  const portAllocator = new PortAllocator(
    repo,
    config.portRangeStart,
    config.portRangeEnd,
  );
  const backupStorage = config.backupImportBucket
    ? new GcsBackupStorage(
        config.backupImportBucket,
        config.backupImportUploadOrigin,
      )
    : null;
  const moveStorage = config.movesBucket ? new GcsBackupStorage(config.movesBucket) : null;
  const pairingManager = new PairingManager(
    repo,
    hosts,
    eventLog,
    pairingConfig,
    log,
    pairingSessions,
    pairingSidecarClient,
  );
  const litellmKeys = LiteLlmKeyManager.fromConfig(config);
  const telegramApi = config.telegramManagerBotToken
    ? new TelegramBotApi(config.telegramManagerBotToken)
    : null;
  const integrationProvider = createIntegrationProvider(config);
  const integrationSessions = integrationProvider
    ? new IntegrationSessions(
        new IntegrationSessionRepository(db, encryptionKey),
        integrationProvider,
        eventLog,
        log,
      )
    : null;
  // Destroy-time cleanups, each best effort; the WhatsApp one joins once its manager exists.
  const destroyCleanups: IntegrationCleanup[] = integrationSessions ? [integrationSessions] : [];
  // One lock order per bot: WhatsApp Business channel work and destroy take this before the instance lock.
  const channelLock = new InstanceOperationLock();
  const manager = new InstanceManager(
    repo,
    hosts,
    portAllocator,
    placement,
    config,
    eventLog,
    pairingManager,
    litellmKeys,
    log,
    backupStorage,
    undefined,
    telegramApi,
    {
      revokeAll: async (inst) => {
        for (const cleanup of destroyCleanups) {
          await cleanup.revokeAll(inst).catch((err) =>
            log.warn({ instanceId: inst.id, err }, "destroy cleanup step failed"),
          );
        }
      },
    },
    channelLock,
    moveStorage,
  );
  log.info({ enabled: moveStorage !== null }, "host-to-host moves");
  const integrations =
    integrationProvider && integrationSessions
      ? new IntegrationsManager(manager, repo, integrationSessions, integrationProvider, eventLog, config, log)
      : null;
  log.info({ provider: integrationProvider?.name ?? null }, "integrations provider");
  // Filling the catalog costs ~9s against Composio; paid at boot so a page load does not.
  integrations?.warmCatalog();
  const backupTransferTokens = new BackupTransferTokenService(
    config.serviceTokens,
  );
  const backupImports = backupStorage
    ? new BackupImportManager(
        backupStorage,
        backupTransferTokens,
        manager,
        config.backupImportTtlSeconds,
      )
    : null;
  const backupExports = backupStorage
    ? new BackupExportManager(manager, backupStorage, log)
    : null;

  const reconciler = new Reconciler({
    repo,
    hosts,
    manager,
    pairingManager,
    logger: log,
    pairingStaleThresholdMs: config.pairingStaleThresholdMs,
  });
  if (config.reconcileOnStartup) {
    try {
      await reconciler.run();
    } catch (err) {
      log.error({ err }, "startup reconciliation failed");
    }
  }

  const healthService = new HealthService(healthRepo);
  await app.register(healthRoutes, { healthService });
  await app.register(instanceRoutes, {
    prefix: "/api/v1/instances",
    manager,
    backupExports,
  });
  if (backupImports) {
    await app.register(backupImportRoutes, {
      prefix: "/api/v1/backup-imports",
      backupImports,
    });
  }
  await app.register(pairingRoutes, {
    prefix: "/api/v1/instances",
    manager,
    pairingManager,
  });
  const telegramLinker = telegramApi
    ? new ManagedBotLinker(telegramApi, manager, eventLog, log)
    : null;
  if (telegramLinker) {
    telegramLinker.start();
    log.info("telegram managed-bot linker started");
  } else {
    log.info("telegram managed-bot linker disabled (no manager bot token)");
  }
  await app.register(telegramRoutes, {
    prefix: "/api/v1/instances",
    manager,
    linker: telegramLinker,
  });
  await app.register(whatsappAccessRoutes, {
    prefix: "/api/v1/instances",
    access: new WhatsappAccessManager(manager, eventLog),
  });
  await app.register(ownerIdentityRoutes, {
    prefix: "/api/v1/instances",
    owner: new OwnerIdentityManager(manager, hosts, eventLog, log),
  });
  await app.register(adminRoutes, {
    prefix: "/api/v1/admin",
    overview: new AdminOverviewService(repo, litellmKeys, log),
    manager,
  });
  await app.register(integrationsRoutes, { prefix: "/api/v1", integrations });
  if (integrations) {
    await app.register(mcpRelayRoutes, {
      prefix: MCP_RELAY_PATH,
      resolveRelay: (instanceId, bearer) => integrations.resolveRelay(instanceId, bearer),
      fetchImpl: createRelayFetch(),
    });
  }
  await app.register(internalPairRoutes, {
    prefix: "/internal",
    pairingManager,
  });
  if (config.workerInstanceIds.size > 0) {
    const audience = new URL("/internal/hosts/register", config.orchestratorInternalUrl).href;
    // remoteDeps is set whenever a worker is managed (checked at boot), so a non-local id never reaches an absent attacher.
    const attachHost = remoteDeps ? createHostAttacher(hosts, config.orchestratorHostId, remoteDeps, log) : undefined;
    const registrar = new HostRegistrar(hostRepo, createGoogleIdTokenVerifier(audience), config.workerInstanceIds, log, attachHost);
    await app.register(internalHostRoutes, { prefix: "/internal", registrar });
    log.info({ audience, workers: [...config.workerInstanceIds.values()] }, "host registration enabled");
  } else {
    log.info("host registration disabled");
  }

  const whatsappCloudRepo = new WhatsappCloudRepository(db, encryptionKey);
  const inboxDispatcher = new InboxDispatcher(whatsappCloudRepo, eventLog, log, {
    pollIntervalMs: config.whatsappCloudInboxPollIntervalMs,
    sweepIntervalMs: config.whatsappCloudInboxSweepIntervalMs,
  });
  const whatsappCloud = new WhatsappCloudManager(
    manager,
    repo,
    whatsappCloudRepo,
    new MetaGraphClient(config.metaGraphBaseUrl, config.metaGraphApiVersion),
    inboxDispatcher,
    eventLog,
    log,
    undefined,
    undefined,
    channelLock,
  );
  destroyCleanups.push({ revokeAll: (inst) => whatsappCloud.cleanupForDestroy(inst) });
  await app.register(whatsappCloudRoutes, { prefix: "/api/v1/instances", manager: whatsappCloud });
  await app.register(whatsappCloudRelayRoutes, { prefix: WHATSAPP_CLOUD_RELAY_PATH, manager: whatsappCloud });
  inboxDispatcher.start();
  const inboxListener = canListenOn(config.databaseUrl)
    ? WhatsappCloudInboxListener.forUrl(config.databaseUrl, (id) => inboxDispatcher.wake(id), log)
    : null;
  // Not awaited: the listener only speeds delivery up, and start-up must not wait on it.
  if (inboxListener) void inboxListener.start();
  else log.warn("DATABASE_URL is Supabase's transaction pooler (port 6543), which cannot hold a LISTEN: whatsapp cloud inbox runs on the poll alone");

  const autoRestarter = config.autoRestartEnabled
    ? new AutoRestarter(manager, eventLog, log, {
        failureThreshold: config.autoRestartFailureThreshold,
        cooldownMs: config.autoRestartCooldownMs,
        maxRestartsPerWindow: config.autoRestartMaxPerWindow,
        windowMs: config.autoRestartWindowMs,
      })
    : null;
  log.info({ enabled: autoRestarter !== null }, "auto restart of unresponsive bots");
  const healthMonitor = new HealthMonitor(
    repo,
    hosts,
    log,
    {
      pollIntervalMs: config.healthPollIntervalMs,
      degradedThreshold: config.healthDegradedThreshold,
      unhealthyThreshold: config.healthUnhealthyThreshold,
      requestTimeoutMs: config.healthRequestTimeoutMs,
      maxConcurrentChecks: config.healthMaxConcurrentChecks,
      channelPollIntervalMs: config.healthChannelPollIntervalMs,
      channelStateMaxAgeMs: config.healthChannelStateMaxAgeMs,
      channelProbeMaxBackoffMs: config.healthChannelProbeMaxBackoffMs,
      channelProbeTimeoutMs: config.healthChannelProbeTimeoutMs,
    },
    Date.now,
    autoRestarter,
  );
  healthMonitor.start();
  memoryWatch.start();

  // Skip tick if a run is in flight, so overlapping intervals don't race on the same rows.
  let reconciling = false;
  const reconcileInterval = setInterval(() => {
    if (reconciling) return;
    reconciling = true;
    reconciler
      .run()
      .catch((err) => log.error({ err }, "periodic reconciliation failed"))
      .finally(() => {
        reconciling = false;
      });
  }, config.reconcileIntervalMs);

  await app.listen({ host: config.host, port: config.port });

  // Order: HTTP first (drain in-flight), then workers, then pool (so final writes land).
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutdown signal received");

    setTimeout(() => {
      console.error(`forced exit after ${config.shutdownTimeoutMs}ms`);
      process.exit(1);
    }, config.shutdownTimeoutMs).unref();

    // Long-polls held open would keep app.close() waiting past the forced-exit timer; release them first.
    inboxDispatcher.stop();
    try {
      await app.close();
    } catch (err) {
      log.error({ err }, "error closing server");
    }

    await healthMonitor.stop();
    await memoryWatch.stop();
    telegramLinker?.stop();
    await inboxListener?.stop();
    clearInterval(reconcileInterval);
    // A restart in flight can outlive the forced-exit timer; give it half the budget, then let pool.end run.
    await autoRestarter?.settle(config.shutdownTimeoutMs / 2);

    try {
      await pool.end();
    } catch (err) {
      log.error({ err }, "error closing database pool");
    }

    log.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import Docker from "dockerode";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig, extractPairingConfig } from "./config.js";
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
import { HealthRepository } from "./storage/health-repository.js";
import { assertValidEncryptionKey } from "./services/crypto.js";
import { ContainerRuntime } from "./services/container-runtime.js";
import { AgentRuntimeRegistry } from "./services/agent-runtime/registry.js";
import { OpenClawRuntimeAdapter } from "./services/agent-runtime/openclaw/adapter.js";
import { HermesRuntimeAdapter } from "./services/agent-runtime/hermes/adapter.js";
import { PortAllocator } from "./services/port-allocator.js";
import { InstanceManager } from "./services/instance-manager.js";
import { HealthMonitor } from "./services/health-monitor.js";
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

function createDockerClient(config: {
  dockerHost?: string;
  dockerPort?: number;
  dockerSocketPath?: string;
}): Docker {
  if (config.dockerHost) {
    return new Docker({
      host: config.dockerHost,
      port: config.dockerPort ?? 2375,
    });
  }
  if (config.dockerSocketPath) {
    return new Docker({ socketPath: config.dockerSocketPath });
  }
  return new Docker();
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

async function main(): Promise<void> {
  const config = loadConfig();
  const encryptionKey = Buffer.from(config.encryptionKey, "hex");
  assertValidEncryptionKey(encryptionKey);

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

  const repo = new InstanceRepository(db, encryptionKey, config.orchestratorHostId);
  log.info({ hostId: config.orchestratorHostId }, "host scoping enabled");
  const eventLog = new EventRepository(db);

  const docker = createDockerClient(config);
  const runtime = new ContainerRuntime(docker, config.dockerNetwork, log);

  await waitForDependency("docker", async () => {
    await runtime.ping();
  });
  log.info("docker connected");

  await runtime.ensureNetworkExists();

  const runtimeAdapters = new AgentRuntimeRegistry([
    new OpenClawRuntimeAdapter(runtime, config.agentRuntimeImage),
    new HermesRuntimeAdapter(runtime, config.hermesRuntimeImage),
  ]);

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
  const pairingManager = new PairingManager(
    repo,
    runtime,
    runtimeAdapters,
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
  const manager = new InstanceManager(
    repo,
    runtime,
    runtimeAdapters,
    portAllocator,
    config,
    eventLog,
    pairingManager,
    litellmKeys,
    log,
    backupStorage,
    undefined,
    telegramApi,
    integrationSessions,
  );
  const integrations =
    integrationProvider && integrationSessions
      ? new IntegrationsManager(manager, repo, integrationSessions, integrationProvider, eventLog, config, log)
      : null;
  log.info({ provider: integrationProvider?.name ?? null }, "integrations provider");
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
    runtime,
    runtimes: runtimeAdapters,
    manager,
    pairingManager,
    logger: log,
    pairingStaleThresholdMs: config.pairingStaleThresholdMs,
  });
  if (config.reconcileOnStartup) {
    await reconciler.run();
  }

  const healthService = new HealthService(healthRepo, runtime);
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
    owner: new OwnerIdentityManager(manager, runtimeAdapters, eventLog, log),
  });
  await app.register(adminRoutes, {
    prefix: "/api/v1/admin",
    overview: new AdminOverviewService(repo, litellmKeys, log),
  });
  await app.register(integrationsRoutes, { prefix: "/api/v1", integrations });
  if (integrations) {
    await app.register(mcpRelayRoutes, {
      prefix: "/api/v1/mcp",
      resolveRelay: (instanceId, bearer) => integrations.resolveRelay(instanceId, bearer),
      fetchImpl: createRelayFetch(),
    });
  }
  await app.register(internalPairRoutes, {
    prefix: "/internal",
    pairingManager,
  });

  const healthMonitor = new HealthMonitor(repo, runtime, runtimeAdapters, log, {
    pollIntervalMs: config.healthPollIntervalMs,
    degradedThreshold: config.healthDegradedThreshold,
    unhealthyThreshold: config.healthUnhealthyThreshold,
    requestTimeoutMs: config.healthRequestTimeoutMs,
    useDockerNetwork: config.nodeEnv === "production",
    maxConcurrentChecks: config.healthMaxConcurrentChecks,
    channelPollIntervalMs: config.healthChannelPollIntervalMs,
    channelStateMaxAgeMs: config.healthChannelStateMaxAgeMs,
    channelProbeMaxBackoffMs: config.healthChannelProbeMaxBackoffMs,
    channelProbeTimeoutMs: config.healthChannelProbeTimeoutMs,
  });
  healthMonitor.start();

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

    try {
      await app.close();
    } catch (err) {
      log.error({ err }, "error closing server");
    }

    healthMonitor.stop();
    telegramLinker?.stop();
    clearInterval(reconcileInterval);

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

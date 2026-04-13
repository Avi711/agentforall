import { Pool } from "pg";
import Docker from "dockerode";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { healthRoutes } from "./routes/health.js";
import { instanceRoutes } from "./routes/instances.js";
import { InstanceRepository } from "./storage/instance-repository.js";
import { ContainerRuntime } from "./services/container-runtime.js";
import { ConfigGenerator } from "./services/config-generator.js";
import { PortAllocator } from "./services/port-allocator.js";
import { InstanceManager } from "./services/instance-manager.js";
import { HealthMonitor } from "./services/health-monitor.js";
import { Reconciler } from "./services/reconciler.js";

const MAX_STARTUP_RETRIES = 10;
const STARTUP_BACKOFF_BASE_MS = 1000;

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

async function main(): Promise<void> {
  const config = loadConfig();
  const encryptionKey = Buffer.from(config.encryptionKey, "hex");

  const app = await createApp(config);
  const log = app.log;

  // --- Database with backoff ---
  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  await waitForDependency("database", async () => {
    await pool.query("SELECT 1");
  });
  log.info("database connected");

  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "../../packages/db/drizzle" });
  log.info("migrations applied");

  const repo = new InstanceRepository(db, encryptionKey);

  // --- Docker with backoff ---
  const docker = createDockerClient(config);
  const runtime = new ContainerRuntime(docker, config.dockerNetwork, log);

  await waitForDependency("docker", async () => {
    await runtime.ping();
  });
  log.info("docker connected");

  await runtime.ensureNetworkExists();

  try {
    await runtime.ensureImagePulled(config.openclawImage);
    log.info({ image: config.openclawImage }, "image ready");
  } catch (err) {
    log.warn({ err }, "image pull failed — may already exist locally");
  }

  // --- Reconciliation ---
  const reconciler = new Reconciler(repo, runtime, log);
  if (config.reconcileOnStartup) {
    await reconciler.run();
  }

  // --- Services ---
  const configGen = new ConfigGenerator();
  const portAllocator = new PortAllocator(
    repo,
    config.portRangeStart,
    config.portRangeEnd,
  );
  const manager = new InstanceManager(
    repo,
    runtime,
    configGen,
    portAllocator,
    config,
    log,
  );

  // --- Routes ---
  await app.register(healthRoutes, { pool, runtime });
  await app.register(instanceRoutes, { prefix: "/api/v1/instances", manager });

  // --- Health Monitor ---
  const healthMonitor = new HealthMonitor(repo, log, {
    pollIntervalMs: config.healthPollIntervalMs,
    degradedThreshold: config.healthDegradedThreshold,
    unhealthyThreshold: config.healthUnhealthyThreshold,
    requestTimeoutMs: config.healthRequestTimeoutMs,
    useDockerNetwork: config.nodeEnv === "production",
  });
  healthMonitor.start();

  // --- Periodic Reconciliation ---
  const reconcileInterval = setInterval(
    () =>
      void reconciler.run().catch((err) => {
        log.error({ err }, "periodic reconciliation failed");
      }),
    config.reconcileIntervalMs,
  );

  // --- Start ---
  await app.listen({ host: config.host, port: config.port });

  // --- Graceful Shutdown ---
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutdown signal received");

    healthMonitor.stop();
    clearInterval(reconcileInterval);

    try {
      await app.close();
    } catch (err) {
      log.error({ err }, "error closing server");
    }

    try {
      await pool.end();
    } catch (err) {
      log.error({ err }, "error closing database pool");
    }

    log.info("shutdown complete");
    process.exit(0);
  };

  const forceExit = (signal: string) => {
    setTimeout(() => {
      console.error(
        `forced exit after ${config.shutdownTimeoutMs}ms (signal: ${signal})`,
      );
      process.exit(1);
    }, config.shutdownTimeoutMs).unref();
  };

  process.on("SIGTERM", () => {
    forceExit("SIGTERM");
    void shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    forceExit("SIGINT");
    void shutdown("SIGINT");
  });
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});

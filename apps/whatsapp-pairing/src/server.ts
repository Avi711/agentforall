import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { BaileysSession } from "./baileys-session.js";
import { registerPairRoutes } from "./routes/pair.js";
import { registerHealthRoutes } from "./routes/health.js";
import { notifyOrchestratorOfCompletion } from "./completion.js";
import { isAuthorized } from "./auth.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      base: {
        service: "whatsapp-pairing",
        instanceId: config.orchestrator.instanceId,
      },
      redact: {
        paths: ["req.headers.authorization"],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });
  const logger = app.log;

  const authTokenBuffer = Buffer.from(config.authToken, "utf8");
  app.addHook("onRequest", async (req, reply) => {
    if (routePath(req.url) === "/healthz") return;
    if (!isAuthorized(req.headers.authorization, authTokenBuffer)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  const session = new BaileysSession(config.sessionDir, logger);
  await registerHealthRoutes(app);
  await registerPairRoutes(app, { session });

  const idle = createIdleWatchdog({
    timeoutMs: config.idleTimeoutMs,
    onTimeout: () => {
      logger.warn({ timeoutMs: config.idleTimeoutMs }, "idle timeout — exiting");
      void shutdown(1);
    },
  });
  app.addHook("onRequest", async (req) => {
    const path = routePath(req.url);
    if (path === "/healthz") return; // don't let healthchecks reset the timer
    if (session.getState().phase === "authenticated") return;
    idle.reset();
  });

  session.on("authenticated", async ({ accountId }: { accountId: string | undefined }) => {
    logger.info({ accountId }, "whatsapp session authenticated");
    idle.clear();
    try {
      await notifyOrchestratorOfCompletion({
        orchestratorBaseUrl: config.orchestrator.baseUrl,
        serviceToken: config.orchestrator.serviceToken,
        instanceId: config.orchestrator.instanceId,
        sessionDir: config.sessionDir,
        accountId,
        log: logger,
      });
      logger.info("orchestrator notified — exiting");
      await shutdown(0);
    } catch (err) {
      logger.error({ err }, "failed to notify orchestrator");
      await shutdown(1);
    }
  });

  session.on("failed", ({ reason }: { reason: string }) => {
    logger.error({ reason }, "pairing failed");
    void shutdown(1);
  });

  await session.start();

  await app.listen({ host: config.host, port: config.port });
  logger.info({ port: config.port }, "pairing sidecar listening");

  let shuttingDown = false;
  async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    idle.clear();
    try {
      await session.shutdown();
    } catch (err) {
      logger.warn({ err }, "session shutdown error");
    }
    try {
      await app.close();
    } catch (err) {
      logger.warn({ err }, "fastify close error");
    }
    // Give pino a tick to drain — Fastify has no typed flush(); enough since the app is already closed.
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.exit(exitCode);
  }

  const onSignal = (signal: string) => {
    logger.info({ signal }, "signal received");
    void shutdown(0);
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

function routePath(rawUrl: string): string {
  const q = rawUrl.indexOf("?");
  return q === -1 ? rawUrl : rawUrl.slice(0, q);
}

interface IdleWatchdog {
  reset(): void;
  clear(): void;
}

function createIdleWatchdog(opts: {
  timeoutMs: number;
  onTimeout: () => void;
}): IdleWatchdog {
  let timer: NodeJS.Timeout | undefined;
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(opts.onTimeout, opts.timeoutMs);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  reset();
  return { reset, clear };
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});

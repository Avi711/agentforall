import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import type { AppConfig } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthHook } from "./middleware/auth.js";

// Pairing-completion overrides per-route with MAX_CREDS_BYTES; everything else stays tight.
const MAX_PUBLIC_BODY_BYTES = 64 * 1024;

// Routes that authenticate themselves (per-session tokens) opt out of the global hook.
declare module "fastify" {
  interface FastifyContextConfig {
    skipGlobalAuth?: boolean;
  }
}

export async function createApp(
  config: AppConfig,
  encryptionKey: Buffer,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          'req.headers["x-act-as-user"]',
          'req.headers["x-account-id"]',
          'req.headers.cookie',
        ],
        censor: "[REDACTED]",
      },
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url.split("?")[0],
            hostname: req.hostname,
            remoteAddress: req.ip,
            reqId: req.id,
          };
        },
      },
    },
    trustProxy: config.trustProxy,
    requestTimeout: 30_000,
    bodyLimit: MAX_PUBLIC_BODY_BYTES,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  });

  app.setErrorHandler(errorHandler);

  // CSP off — this is an API; dashboard (Vercel) sets its own.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  // For the sidecar → orchestrator creds callback.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  // Auth must register before rate-limit — onRequest hooks run in registration order,
  // and rate-limit's keyGenerator needs `authenticatedUserId`.
  const authenticate = createAuthHook({
    apiKeys: config.apiKeys,
    serviceTokens: config.serviceTokens,
    hmacSecret: encryptionKey,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    if (request.routeOptions?.config?.skipGlobalAuth) return;
    await authenticate(request, reply);
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => request.authenticatedUserId ?? request.ip,
  });

  return app;
}

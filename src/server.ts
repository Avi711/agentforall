import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthHook } from "./middleware/auth.js";

export async function createApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip,
          };
        },
      },
    },
    trustProxy: config.trustProxy,
    requestTimeout: 30_000,
    bodyLimit: 1_048_576,
  });

  app.setErrorHandler(errorHandler);

  const encryptionKey = Buffer.from(config.encryptionKey, "hex");

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => request.authenticatedUserId ?? request.ip,
  });

  const authenticate = createAuthHook(config.apiKeys, encryptionKey);
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    await authenticate(request, reply);
  });

  return app;
}

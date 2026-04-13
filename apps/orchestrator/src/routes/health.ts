import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import type { ContainerRuntime } from "../services/container-runtime.js";

export interface HealthDeps {
  pool: Pool;
  runtime: ContainerRuntime;
}

export const healthRoutes: FastifyPluginAsync<HealthDeps> = async (
  app,
  deps,
) => {
  app.get("/health", async (_request, reply) => {
    const checks: Record<string, "ok" | "error"> = {};

    try {
      await deps.pool.query("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }

    try {
      await deps.runtime.ping();
      checks.docker = "ok";
    } catch {
      checks.docker = "error";
    }

    const allOk = Object.values(checks).every((v) => v === "ok");
    const status = allOk ? "healthy" : "unhealthy";
    const httpStatus = allOk ? 200 : 503;

    return reply.status(httpStatus).send({ status, checks });
  });
};

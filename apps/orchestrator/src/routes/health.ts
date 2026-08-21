import type { FastifyPluginAsync } from "fastify";
import type { HealthService } from "../services/health-service.js";

export interface HealthDeps {
  healthService: HealthService;
}

export const healthRoutes: FastifyPluginAsync<HealthDeps> = async (
  app,
  deps,
) => {
  app.get("/health", async (_request, reply) => {
    const report = await deps.healthService.check();
    return reply
      .status(report.httpStatus)
      .send({ status: report.status, checks: report.checks });
  });
};

import type { FastifyPluginAsync } from "fastify";
import type { AdminOverviewService } from "../services/admin-overview.js";
import { sanitizeInstance } from "./instances.js";

export interface AdminRouteDeps {
  overview: AdminOverviewService;
}

// Platform-level reads: service token only (config.serviceScope), never user impersonation.
export const adminRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, deps) => {
  app.get("/instances", { config: { serviceScope: true } }, async (_request, reply) => {
    const rows = await deps.overview.listInstances();
    return reply.send({
      data: rows.map((row) => ({ instance: sanitizeInstance(row.instance), usage: row.usage })),
    });
  });
};

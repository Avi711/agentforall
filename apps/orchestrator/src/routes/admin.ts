import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AdminOverviewService } from "../services/admin-overview.js";
import type { InstanceManager } from "../services/instance-manager.js";
import { sanitizeInstance } from "./instances.js";

export interface AdminRouteDeps {
  overview: AdminOverviewService;
  manager: Pick<InstanceManager, "move">;
}

const UuidParam = z.object({ id: z.string().uuid() });
const MoveBody = z
  .object({
    targetHostId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
    dryRun: z.boolean().optional(),
  })
  .strict();

// Platform-level reads and operator actions: service token only (config.serviceScope), never user impersonation.
export const adminRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, deps) => {
  app.get("/instances", { config: { serviceScope: true } }, async (_request, reply) => {
    const rows = await deps.overview.listInstances();
    return reply.send({
      data: rows.map((row) => ({ instance: sanitizeInstance(row.instance), usage: row.usage })),
    });
  });

  app.post("/instances/:id/move", { config: { serviceScope: true } }, async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = MoveBody.parse(request.body);
    await deps.manager.move(id, body.targetHostId, { dryRun: body.dryRun ?? false });
    return reply.status(204).send();
  });
};

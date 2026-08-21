import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async (_req, reply) => {
    return reply.send({ ok: true });
  });
}

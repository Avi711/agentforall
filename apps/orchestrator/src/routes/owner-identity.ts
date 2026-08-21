import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { OwnerIdentityManager } from "../services/owner-identity-manager.js";

const UuidParam = z.object({ id: z.string().uuid() });

const OwnerPatchBody = z
  .object({
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{6,14}$/, "whatsappNumber must be E.164")
      .nullable(),
  })
  .strict();

export interface OwnerIdentityRouteDeps {
  owner: OwnerIdentityManager;
}

export const ownerIdentityRoutes: FastifyPluginAsync<OwnerIdentityRouteDeps> = async (
  app,
  deps,
) => {
  app.get("/:id/owner", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const view = await deps.owner.get(id, request.authenticatedUserId);
    return reply.send(view);
  });

  app.patch("/:id/owner", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = OwnerPatchBody.parse(request.body);
    const view = await deps.owner.update(id, request.authenticatedUserId, body);
    return reply.send(view);
  });
};

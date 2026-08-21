import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { WHATSAPP_DM_ACCESS } from "../domain/types.js";
import type { WhatsappAccessManager } from "../services/whatsapp-access-manager.js";

const UuidParam = z.object({ id: z.string().uuid() });

const AccessPatchBody = z.object({ access: z.enum(WHATSAPP_DM_ACCESS) }).strict();

export interface WhatsappAccessRouteDeps {
  access: WhatsappAccessManager;
}

export const whatsappAccessRoutes: FastifyPluginAsync<WhatsappAccessRouteDeps> = async (
  app,
  deps,
) => {
  app.get("/:id/whatsapp/access", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const view = await deps.access.get(id, request.authenticatedUserId);
    return reply.send(view);
  });

  app.patch("/:id/whatsapp/access", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = AccessPatchBody.parse(request.body);
    const view = await deps.access.update(id, request.authenticatedUserId, body);
    return reply.send(view);
  });
};

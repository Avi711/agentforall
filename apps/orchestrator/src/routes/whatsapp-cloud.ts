import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { PHONE_NUMBER_ID_PATTERN, PIN_PATTERN } from "../domain/whatsapp-cloud.js";
import type { WhatsappCloudManager } from "../services/whatsapp-cloud/manager.js";

const UuidParam = z.object({ id: z.string().uuid() });
const ConnectBody = z
  .object({
    accessToken: z.string().min(1).max(4096),
    phoneNumberId: z.string().regex(PHONE_NUMBER_ID_PATTERN),
    wabaId: z.string().regex(PHONE_NUMBER_ID_PATTERN),
    businessId: z.string().regex(PHONE_NUMBER_ID_PATTERN),
    pin: z.string().regex(PIN_PATTERN).optional(),
  })
  .strict();

export interface WhatsappCloudRouteDeps {
  manager: WhatsappCloudManager;
}

export const whatsappCloudRoutes: FastifyPluginAsync<WhatsappCloudRouteDeps> = async (app, deps) => {
  app.post("/:id/whatsapp-cloud/connect", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = ConnectBody.parse(request.body);
    const view = await deps.manager.connect(id, request.authenticatedUserId, body);
    return reply.status(201).send(view);
  });

  app.post("/:id/whatsapp-cloud/disconnect", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await deps.manager.disconnect(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.get("/:id/whatsapp-cloud/status", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    return reply.send(await deps.manager.status(id, request.authenticatedUserId));
  });
};

import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { FeatureUnavailableError } from "../domain/errors.js";
import type { InstanceManager } from "../services/instance-manager.js";
import type { ManagedBotLinker } from "../services/telegram/managed-bot-linker.js";

const UuidParam = z.object({ id: z.string().uuid() });

export interface TelegramRouteDeps {
  manager: InstanceManager;
  linker: ManagedBotLinker | null;
}

export const telegramRoutes: FastifyPluginAsync<TelegramRouteDeps> = async (
  app,
  deps,
) => {
  const requireLinker = (): ManagedBotLinker => {
    if (!deps.linker) throw new FeatureUnavailableError("telegram linking");
    return deps.linker;
  };

  app.post("/:id/telegram/link", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const link = await requireLinker().createLink(
      id,
      request.authenticatedUserId,
    );
    return reply.status(201).send(link);
  });

  app.get("/:id/telegram/status", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const status = await requireLinker().getStatus(
      id,
      request.authenticatedUserId,
    );
    return reply.send(status);
  });

  // Works without a linker too: an already-linked bot must stay disconnectable.
  app.post("/:id/telegram/disconnect", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    deps.linker?.cancelLink(id);
    await deps.manager.disconnectTelegram(id, request.authenticatedUserId);
    return reply.status(204).send();
  });
};

import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { BackupImportManager } from "../services/backup-import-manager.js";
import type { Instance } from "../domain/types.js";

const CreateUploadBody = z.object({
  displayName: z.string().min(1).max(255),
  contentLength: z.number().int().positive(),
  contentType: z.string().min(1).max(128).optional(),
});

const RestoreBody = z.object({
  restoreToken: z.string().min(1),
});

export interface BackupImportRouteDeps {
  backupImports: BackupImportManager;
}

export const backupImportRoutes: FastifyPluginAsync<BackupImportRouteDeps> = async (
  app,
  deps,
) => {
  const { backupImports } = deps;

  app.post("/", async (request, reply) => {
    const body = CreateUploadBody.parse(request.body);
    const session = await backupImports.createUploadSession({
      userId: request.authenticatedUserId,
      displayName: body.displayName,
      contentLength: body.contentLength,
      contentType: body.contentType,
    });
    return reply.status(201).send(session);
  });

  app.post("/restore", async (request, reply) => {
    const body = RestoreBody.parse(request.body);
    const instance = await backupImports.restoreUploadedBackup(
      request.authenticatedUserId,
      body.restoreToken,
    );
    return reply.status(201).send(sanitize(instance));
  });
};

function sanitize(inst: Instance): Record<string, unknown> {
  const { gatewayToken: _token, config, ...safe } = inst;
  return {
    ...safe,
    config: {
      ...config,
      provider: { ...config.provider, apiKey: "***" },
      channels: config.channels.map(maskChannel),
    },
  };
}

function maskChannel(
  ch: Instance["config"]["channels"][number],
): Record<string, unknown> {
  switch (ch.type) {
    case "telegram":
      return { ...ch, botToken: "***" };
    case "discord":
      return { ...ch, token: "***" };
    case "slack":
      return { ...ch, botToken: "***", appToken: "***" };
    case "whatsapp":
      return { ...ch };
  }
}

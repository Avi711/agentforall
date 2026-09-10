import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { BackupImportManager } from "../services/backup-import-manager.js";
import { sanitizeInstance } from "./instances.js";

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
    return reply.status(201).send(sanitizeInstance(instance));
  });
};

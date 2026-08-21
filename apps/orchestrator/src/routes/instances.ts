import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { InstanceManager } from "../services/instance-manager.js";
import {
  LLM_PROVIDERS,
  MODEL_INPUT_CAPABILITIES,
  PROVIDER_MEDIA_CAPABILITIES,
  WHATSAPP_DM_ACCESS,
  type Instance,
} from "../domain/types.js";
import type { BackupExportManager } from "../services/backup-export-manager.js";
import { NotFoundError } from "../domain/errors.js";

const UuidParam = z.object({ id: z.string().uuid() });
const ExportJobParam = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
});

const ChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1).optional(),
    botUsername: z
      .string()
      .regex(/^[a-zA-Z0-9_]{5,32}$/, "invalid telegram username")
      .optional(),
    botId: z.number().int().positive().optional(),
    dmPolicy: z.enum(["pairing", "open", "allowlist"]).optional(),
    allowFrom: z.array(z.string().min(1).max(64)).max(10).optional(),
  }),
  z.object({
    type: z.literal("discord"),
    token: z.string().min(1),
    guildId: z.string().optional(),
  }),
  z.object({
    type: z.literal("slack"),
    botToken: z.string().min(1),
    appToken: z.string().min(1),
  }),
  z.object({
    type: z.literal("whatsapp"),
    ownerNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, "ownerNumber must be E.164").optional(),
    dmAccess: z.enum(WHATSAPP_DM_ACCESS).optional(),
  }),
]);

const ProviderIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "invalid provider id");

const ProviderSchema = z.object({
  name: z.enum(LLM_PROVIDERS),
  id: ProviderIdSchema.optional(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  input: z.array(z.enum(MODEL_INPUT_CAPABILITIES)).max(8).optional(),
  media: z.array(z.enum(PROVIDER_MEDIA_CAPABILITIES)).max(8).optional(),
  fallbacks: z.array(z.string()).max(5).optional(),
});

const CreateInstanceBody = z.object({
  displayName: z.string().min(1).max(255),
  provider: ProviderSchema.optional(),
  channels: z
    .array(ChannelSchema)
    .min(1, "at least one channel required")
    .max(10)
    .refine(
      (chs) => new Set(chs.map((c) => c.type)).size === chs.length,
      { message: "duplicate channel types are not allowed" },
    ),
  resources: z
    .object({
      memoryMb: z.number().int().min(256).max(4096).optional(),
      cpuShares: z.number().int().min(128).max(4096).optional(),
    })
    .optional(),
});
type CreateInstanceBody = z.infer<typeof CreateInstanceBody>;

const PatchConfigBody = z
  .object({
    displayName: z.string().min(1).max(255).optional(),
    provider: ProviderSchema.partial().optional(),
    channels: z.array(ChannelSchema).min(1).max(10).optional(),
    resources: z
      .object({
        memoryMb: z.number().int().min(256).max(4096).optional(),
        cpuShares: z.number().int().min(128).max(4096).optional(),
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field required",
  });
type PatchConfigBody = z.infer<typeof PatchConfigBody>;

const LiteLlmBudgetBody = z.object({
  budgetCents: z.number().int().min(1).max(1_000_000),
});

// Composite cursor `<iso>:<uuid>` — stable-sorts same-ms peers.
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z):([0-9a-f-]{36})$/i;
const ListQuery = z.object({
  cursor: z
    .string()
    .regex(CURSOR_RE, "cursor must be '<iso8601>:<uuid>'")
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const match = CURSOR_RE.exec(raw)!;
      return { createdAt: new Date(match[1]!), id: match[2]! };
    }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function encodeCursor(inst: { createdAt: Date; id: string }): string {
  return `${inst.createdAt.toISOString()}:${inst.id}`;
}

export interface InstanceRouteDeps {
  manager: InstanceManager;
  backupExports: BackupExportManager | null;
}

export const instanceRoutes: FastifyPluginAsync<InstanceRouteDeps> = async (
  app,
  deps,
) => {
  const { manager, backupExports } = deps;

  app.post("/", async (request, reply) => {
    const body = CreateInstanceBody.parse(request.body);
    const userId = request.authenticatedUserId;
    const instance = await manager.create(userId, body);
    return reply.status(201).send(sanitize(instance));
  });

  app.get("/", async (request, reply) => {
    const userId = request.authenticatedUserId;
    const { cursor, limit } = ListQuery.parse(request.query);
    const list = await manager.list(userId, cursor, limit);
    const last = list[list.length - 1];
    const nextCursor = list.length === limit && last ? encodeCursor(last) : undefined;
    return reply.send({ data: list.map(sanitize), cursor: nextCursor });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const instance = await manager.get(id, request.authenticatedUserId);
    return reply.send(sanitize(instance));
  });

  app.post("/:id/exports", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    if (!backupExports) throw new Error("backup export storage is not configured");
    const job = await backupExports.startDownloadJob(
      id,
      request.authenticatedUserId,
    );
    return reply.status(202).send(job);
  });

  app.get("/:id/exports/:jobId", async (request, reply) => {
    const { id, jobId } = ExportJobParam.parse(request.params);
    if (!backupExports) throw new Error("backup export storage is not configured");
    const job = backupExports.getDownloadJob(id, request.authenticatedUserId, jobId);
    if (!job) throw new NotFoundError("export job", jobId);
    return reply.send(job);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.destroy(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.post("/:id/start", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.start(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.post("/:id/restart", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.restart(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.post("/:id/recreate", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.recreate(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.post("/:id/stop", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.stop(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.patch("/:id/config", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = PatchConfigBody.parse(request.body);
    const instance = await manager.updateConfig(
      id,
      request.authenticatedUserId,
      body,
    );
    return reply.send(sanitize(instance));
  });

  app.patch("/:id/litellm-budget", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = LiteLlmBudgetBody.parse(request.body);
    const instance = await manager.updateLiteLlmBudget(
      id,
      request.authenticatedUserId,
      body.budgetCents,
    );
    return reply.send(sanitize(instance));
  });

  app.get("/:id/usage", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const usage = await manager.getUsage(id, request.authenticatedUserId);
    return reply.send(usage);
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
    litellm: inst.litellm,
  };
}

function maskChannel(
  ch: Instance["config"]["channels"][number],
): Record<string, unknown> {
  switch (ch.type) {
    case "telegram":
      return ch.botToken ? { ...ch, botToken: "***" } : { ...ch };
    case "discord":
      return { ...ch, token: "***" };
    case "slack":
      return { ...ch, botToken: "***", appToken: "***" };
    case "whatsapp":
      return { ...ch };
  }
}

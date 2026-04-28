import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { InstanceManager } from "../services/instance-manager.js";
import type { Instance, CreateInstanceInput, ConfigPatch } from "../domain/types.js";

const UuidParam = z.object({ id: z.string().uuid() });

const ChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1),
    dmPolicy: z.enum(["pairing", "open", "allowlist"]).optional(),
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
  z.object({ type: z.literal("whatsapp") }),
]);

const CreateInstanceBody = z.object({
  displayName: z.string().min(1).max(255),
  provider: z
    .object({
      name: z.enum(["anthropic", "openai", "openrouter", "gemini"]),
      apiKey: z.string().min(1),
      model: z.string().min(1),
      fallbacks: z.array(z.string()).max(5).optional(),
    })
    .optional(),
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

const PatchConfigBody = z
  .object({
    displayName: z.string().min(1).max(255).optional(),
    provider: z
      .object({
        name: z.enum(["anthropic", "openai", "openrouter", "gemini"]).optional(),
        apiKey: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        fallbacks: z.array(z.string()).max(5).optional(),
      })
      .optional(),
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

// Composite cursor `<iso>:<uuid>` — stable-sorts same-ms peers.
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T[^:]+Z):([0-9a-f-]{36})$/i;
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
}

export const instanceRoutes: FastifyPluginAsync<InstanceRouteDeps> = async (
  app,
  deps,
) => {
  const { manager } = deps;

  app.post("/", async (request, reply) => {
    const body = CreateInstanceBody.parse(request.body);
    const userId = request.authenticatedUserId;
    const instance = await manager.create(userId, body as CreateInstanceInput);
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
      body as ConfigPatch,
    );
    return reply.send(sanitize(instance));
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

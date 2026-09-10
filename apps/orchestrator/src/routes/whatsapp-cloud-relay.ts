import { Readable } from "node:stream";
import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AuthenticationError } from "../domain/errors.js";
import {
  ESCALATION_KINDS,
  INBOX_MAX_WAIT_MS,
  ESCALATION_SUMMARY_MAX_CHARS,
  RELAY_MAX_BODY_BYTES,
  RELAY_RATE_LIMIT_PER_MINUTE,
  SEND_TEXT_MAX_CHARS,
  WA_ID_PATTERN,
  WHATSAPP_CLOUD_CONVERSATION_MODES,
  WHATSAPP_CLOUD_SEND_KINDS,
} from "../domain/whatsapp-cloud.js";
import type { RelayContext, WhatsappCloudManager } from "../services/whatsapp-cloud/manager.js";
import { extractBearer } from "./bearer.js";
import { relayRateLimitKey } from "./relay-rate-limit.js";

const Param = z.object({ instanceId: z.string().uuid() });
const WaIdParam = Param.extend({ waId: z.string().regex(WA_ID_PATTERN) });
const MediaParam = Param.extend({ mediaId: z.string().regex(/^\d{1,64}$/) });
const InboxQuery = z.object({ wait: z.coerce.number().int().min(0).max(INBOX_MAX_WAIT_MS).default(INBOX_MAX_WAIT_MS) });
const AckBody = z.object({ ids: z.array(z.string().regex(/^\d{1,19}$/)).min(1).max(200) }).strict();
const SendBody = z
  .object({
    to: z.string().regex(WA_ID_PATTERN),
    text: z.string().min(1).max(SEND_TEXT_MAX_CHARS),
    replyToId: z.string().min(1).max(255).optional(),
    kind: z.enum(WHATSAPP_CLOUD_SEND_KINDS).default("reply"),
  })
  .strict();
const ReadBody = z.object({ wamid: z.string().min(1).max(255), typing: z.boolean().default(false) }).strict();
const EscalateBody = z
  .object({
    waId: z.string().regex(WA_ID_PATTERN),
    summary: z.string().min(1).max(ESCALATION_SUMMARY_MAX_CHARS),
    kind: z.enum(ESCALATION_KINDS).default("request"),
  })
  .strict();
const ModeBody = z.object({ mode: z.enum(WHATSAPP_CLOUD_CONVERSATION_MODES) }).strict();

export interface WhatsappCloudRelayDeps {
  manager: WhatsappCloudManager;
}

// Container-facing. Reachable on tenant-net only; the bearer is the bot's channel relay token.
export const whatsappCloudRelayRoutes: FastifyPluginAsync<WhatsappCloudRelayDeps> = async (app, deps) => {
  const contexts = new WeakMap<FastifyRequest, RelayContext>();

  // preHandler, not onRequest: the route-level rate limit hook must run before the bearer lookup.
  app.addHook("preHandler", async (request) => {
    const { instanceId } = Param.parse(request.params);
    const bearer = extractBearer(request.headers.authorization);
    if (!bearer) throw new AuthenticationError();
    contexts.set(request, await deps.manager.resolveRelay(instanceId, bearer));
  });

  const ctxOf = (request: FastifyRequest): RelayContext => {
    const ctx = contexts.get(request);
    if (!ctx) throw new AuthenticationError();
    return ctx;
  };

  const routeConfig = {
    skipGlobalAuth: true,
    rateLimit: {
      max: RELAY_RATE_LIMIT_PER_MINUTE,
      timeWindow: 60_000,
      keyGenerator: relayRateLimitKey,
    },
  };

  app.get("/:instanceId/inbox", { config: routeConfig }, async (request, reply) => {
    const ctx = ctxOf(request);
    const { wait } = InboxQuery.parse(request.query);
    const items = await deps.manager.pull(ctx.instance.id, wait);
    return reply.send({ items: items.map((item) => ({ ...item, timestamp: item.timestamp.toISOString() })) });
  });

  app.post("/:instanceId/inbox/ack", { config: routeConfig, bodyLimit: RELAY_MAX_BODY_BYTES }, async (request, reply) => {
    const ctx = ctxOf(request);
    const { ids } = AckBody.parse(request.body);
    const acked = await deps.manager.ack(ctx.instance.id, ids.map((id) => BigInt(id)));
    return reply.send({ acked });
  });

  app.post("/:instanceId/send", { config: routeConfig, bodyLimit: RELAY_MAX_BODY_BYTES }, async (request, reply) => {
    const ctx = ctxOf(request);
    const body = SendBody.parse(request.body);
    const wamid = await deps.manager.send(ctx, body);
    return reply.status(201).send({ wamid });
  });

  app.post("/:instanceId/read", { config: routeConfig, bodyLimit: RELAY_MAX_BODY_BYTES }, async (request, reply) => {
    const ctx = ctxOf(request);
    const body = ReadBody.parse(request.body);
    await deps.manager.markRead(ctx, body.wamid, body.typing);
    return reply.status(204).send();
  });

  app.get("/:instanceId/media/:mediaId", { config: routeConfig }, async (request, reply) => {
    const ctx = ctxOf(request);
    const { mediaId } = MediaParam.parse(request.params);
    // A plugin that hangs up mid-download must not leave the CDN stream open on its behalf.
    const gone = new AbortController();
    request.raw.on("close", () => gone.abort());
    const download = await deps.manager.media(ctx, mediaId, gone.signal);
    reply.header("content-type", download.contentType);
    return reply.send(Readable.fromWeb(download.body));
  });

  app.post("/:instanceId/escalate", { config: routeConfig, bodyLimit: RELAY_MAX_BODY_BYTES }, async (request, reply) => {
    const ctx = ctxOf(request);
    return reply.send(await deps.manager.escalate(ctx, EscalateBody.parse(request.body)));
  });

  app.get("/:instanceId/conversations/:waId", { config: routeConfig }, async (request, reply) => {
    const ctx = ctxOf(request);
    const { waId } = WaIdParam.parse(request.params);
    const conversation = await deps.manager.conversation(ctx, waId);
    return reply.send({ conversation });
  });

  app.post(
    "/:instanceId/conversations/:waId/mode",
    { config: routeConfig, bodyLimit: RELAY_MAX_BODY_BYTES },
    async (request, reply) => {
      const ctx = ctxOf(request);
      const { waId } = WaIdParam.parse(request.params);
      const { mode } = ModeBody.parse(request.body);
      return reply.send({ conversation: await deps.manager.setMode(ctx, waId, mode) });
    },
  );
};

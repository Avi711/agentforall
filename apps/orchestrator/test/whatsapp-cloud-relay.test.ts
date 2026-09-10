import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { AuthenticationError, ConversationHeldByOwnerError, CustomerWindowClosedError } from "../src/domain/errors.js";
import type { InboundMessage } from "../src/domain/whatsapp-cloud.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { relayRateLimitKey } from "../src/routes/relay-rate-limit.js";
import { whatsappCloudRelayRoutes } from "../src/routes/whatsapp-cloud-relay.js";
import type { RelayContext, WhatsappCloudManager } from "../src/services/whatsapp-cloud/manager.js";
import { makeInstance, makeWhatsappCloudChannel } from "./helpers/fixtures.js";

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "cloud-relay-token";
const CUSTOMER = "972501234567";

const calls: { method: string; args: unknown[] }[] = [];
let app: FastifyInstance;
let base: string;

const context: RelayContext = {
  instance: makeInstance([makeWhatsappCloudChannel()]),
  channel: makeWhatsappCloudChannel(),
};

const record = (method: string) => (...args: unknown[]) => {
  calls.push({ method, args });
};

const fakeManager = {
  resolveRelay: async (instanceId: string, bearer: string) => {
    if (instanceId !== ID || bearer !== TOKEN) throw new AuthenticationError();
    return context;
  },
  pull: async (_id: string, wait: number): Promise<InboundMessage[]> => {
    record("pull")(wait);
    return [{ id: "7", wamid: "wamid.7", from: CUSTOMER, profileName: "Dana", timestamp: new Date(0), message: { type: "text", text: { body: "hi" } } }];
  },
  ack: async (_id: string, ids: bigint[]) => {
    record("ack")(ids);
    return ids.length;
  },
  send: async (_ctx: RelayContext, input: unknown) => {
    record("send")(input);
    if ((input as { to: string }).to === "972500000000") throw new CustomerWindowClosedError();
    if ((input as { to: string }).to === "972500000009") throw new ConversationHeldByOwnerError();
    return "wamid.sent";
  },
  markRead: async (_ctx: RelayContext, wamid: string, typing: boolean) => record("markRead")(wamid, typing),
  media: async (_ctx: RelayContext, mediaId: string, signal: AbortSignal) => {
    record("media")(mediaId, signal instanceof AbortSignal);
    return {
      contentType: "image/jpeg",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("jpeg-bytes"));
          controller.close();
        },
      }),
    };
  },
  escalate: async (_ctx: RelayContext, input: unknown) => {
    record("escalate")(input);
    return { notified: true, fallbackToBot: false };
  },
  conversation: async (_ctx: RelayContext, waId: string) => ({ instanceId: ID, waId, profileName: "Dana", lastInboundAt: null, lastOutboundAt: null, mode: "bot", updatedAt: new Date(0) }),
  setMode: async (_ctx: RelayContext, waId: string, mode: string) => ({ instanceId: ID, waId, profileName: null, lastInboundAt: null, lastOutboundAt: null, mode, updatedAt: new Date(0) }),
} as unknown as WhatsappCloudManager;

before(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: 60_000 });
  await app.register(whatsappCloudRelayRoutes, { prefix: "/api/v1/whatsapp-cloud", manager: fakeManager });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v1/whatsapp-cloud`;
});

after(async () => {
  await app.close();
});

const auth = { authorization: `Bearer ${TOKEN}` };

test("every relay route needs the channel bearer", async () => {
  const noAuth = await fetch(`${base}/${ID}/inbox`);
  assert.equal(noAuth.status, 401);
  const wrong = await fetch(`${base}/${ID}/inbox`, { headers: { authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);
  const otherBot = await fetch(`${base}/22222222-2222-4222-8222-222222222222/inbox`, { headers: auth });
  assert.equal(otherBot.status, 401);
});

test("the inbox long-poll returns queued messages with ISO timestamps and honours the wait cap", async () => {
  calls.length = 0;
  const res = await fetch(`${base}/${ID}/inbox?wait=5`, { headers: auth });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: { id: string; timestamp: string; message: unknown }[] };
  assert.equal(body.items[0]?.id, "7");
  assert.equal(body.items[0]?.timestamp, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(calls, [{ method: "pull", args: [5] }]);

  const tooLong = await fetch(`${base}/${ID}/inbox?wait=999999`, { headers: auth });
  assert.equal(tooLong.status, 400);
});

test("acks are validated and passed through as bigints", async () => {
  calls.length = 0;
  const res = await fetch(`${base}/${ID}/inbox/ack`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ ids: ["7", "8"] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { acked: 2 });
  assert.deepEqual(calls, [{ method: "ack", args: [[7n, 8n]] }]);

  const bad = await fetch(`${base}/${ID}/inbox/ack`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ ids: ["x"] }),
  });
  assert.equal(bad.status, 400);
});

test("send returns the wamid and a closed window is a 409 the plugin can explain", async () => {
  const ok = await fetch(`${base}/${ID}/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ to: CUSTOMER, text: "שלום" }),
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(await ok.json(), { wamid: "wamid.sent" });

  const closed = await fetch(`${base}/${ID}/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ to: "972500000000", text: "x" }),
  });
  assert.equal(closed.status, 409);
  assert.equal(((await closed.json()) as { code: string }).code, "CUSTOMER_WINDOW_CLOSED");

  const invalid = await fetch(`${base}/${ID}/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ to: "+972501234567", text: "x" }),
  });
  assert.equal(invalid.status, 400);
});

test("media streams through with the upstream content type, and the download follows the caller's connection", async () => {
  const res = await fetch(`${base}/${ID}/media/555`, { headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(await res.text(), "jpeg-bytes");
  assert.deepEqual(calls.find((c) => c.method === "media")?.args, ["555", true]);
});

test("a relay body over the cap is refused before it is parsed", async () => {
  const res = await fetch(`${base}/${ID}/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ to: CUSTOMER, text: "x".repeat(70 * 1024) }),
  });
  assert.equal(res.status, 413);
});

test("read receipts, escalation and handoff reach the manager with validated bodies", async () => {
  calls.length = 0;
  const read = await fetch(`${base}/${ID}/read`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ wamid: "wamid.7", typing: true }),
  });
  assert.equal(read.status, 204);

  const escalate = await fetch(`${base}/${ID}/escalate`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ waId: CUSTOMER, summary: "מבקש הצעת מחיר" }),
  });
  assert.equal(escalate.status, 200);
  assert.deepEqual(await escalate.json(), { notified: true, fallbackToBot: false });
  const badKind = await fetch(`${base}/${ID}/escalate`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ waId: CUSTOMER, summary: "x", kind: "shout" }),
  });
  assert.equal(badKind.status, 400);

  const mode = await fetch(`${base}/${ID}/conversations/${CUSTOMER}/mode`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ mode: "human" }),
  });
  assert.equal(mode.status, 200);
  assert.equal(((await mode.json()) as { conversation: { mode: string } }).conversation.mode, "human");

  assert.deepEqual(
    calls.map((c) => c.method),
    ["markRead", "escalate"],
  );
  assert.deepEqual(calls[0]?.args, ["wamid.7", true]);
  assert.deepEqual(calls[1]?.args, [{ waId: CUSTOMER, summary: "מבקש הצעת מחיר", kind: "request" }]);
});

test("the relay rate limit is keyed by the socket peer alone: neither a forged X-Forwarded-For nor an invented bot id buys a new bucket", () => {
  const request = (remoteAddress: string, ip: string, instanceId?: string) =>
    ({ ip, socket: { remoteAddress }, params: instanceId ? { instanceId } : {} }) as unknown as FastifyRequest;
  assert.equal(relayRateLimitKey(request("10.0.0.5", "1.2.3.4", ID)), "10.0.0.5");
  assert.equal(relayRateLimitKey(request("10.0.0.5", "5.6.7.8", "22222222-2222-4222-8222-222222222222")), "10.0.0.5");
  assert.equal(relayRateLimitKey(request("10.0.0.6", "1.2.3.4", ID)), "10.0.0.6");
});

test("an unauthenticated burst is rate limited before any bearer lookup", async () => {
  const limited = Fastify();
  limited.setErrorHandler(errorHandler);
  await limited.register(rateLimit, { max: 1000, timeWindow: 60_000 });
  let lookups = 0;
  await limited.register(whatsappCloudRelayRoutes, {
    prefix: "/api/v1/whatsapp-cloud",
    manager: {
      resolveRelay: async () => {
        lookups += 1;
        throw new AuthenticationError();
      },
    } as unknown as WhatsappCloudManager,
  });
  await limited.listen({ port: 0, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${(limited.server.address() as AddressInfo).port}/api/v1/whatsapp-cloud/${ID}/inbox`;
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 601; i++) statuses.push((await fetch(url, { headers: { authorization: "Bearer nope" } })).status);
    assert.equal(statuses[0], 401);
    assert.equal(statuses[600], 429);
    assert.equal(lookups, 600);
  } finally {
    await limited.close();
  }
});

test("a bot reply to a customer the owner holds is a 409 the plugin drops without retrying", async () => {
  const res = await fetch(`${base}/${ID}/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ to: "972500000009", text: "from the bot", kind: "reply" }),
  });

  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "CONVERSATION_HELD_BY_OWNER");
});

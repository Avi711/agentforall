import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { AuthenticationError } from "../src/domain/errors.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { mcpRelayRoutes } from "../src/routes/mcp-relay.js";
import { createRelayFetch } from "../src/services/integrations/relay-fetch.js";

const LIVE = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";
const REDIRECTING = "33333333-3333-4333-8333-333333333333";
const TOKEN = "relay-token";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const upstreamSeen: Seen[] = [];
let upstreamClosed = 0;
let upstream: http.Server;
let upstreamUrl: string;
let app: FastifyInstance;
let relayBase: string;

before(async () => {
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      upstreamSeen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url?.endsWith("/gone")) {
        res.writeHead(404).end("session not found");
        return;
      }
      if (req.url?.endsWith("/redirect")) {
        res.writeHead(302, { location: "https://elsewhere.example/" }).end();
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "sess-1" });
        res.write("event: message\ndata: first\n\n");
        const timer = setInterval(() => res.write("event: message\ndata: tick\n\n"), 20);
        res.on("close", () => {
          clearInterval(timer);
          upstreamClosed += 1;
        });
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
      res.end(JSON.stringify({ echo: JSON.parse(Buffer.concat(chunks).toString() || "null") }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: 60_000 });
  await app.register(mcpRelayRoutes, {
    prefix: "/api/v1/mcp",
    fetchImpl: createRelayFetch(),
    resolveRelay: async (instanceId, bearer) => {
      if (bearer !== TOKEN) throw new AuthenticationError();
      if (instanceId === LIVE) return { upstreamUrl: `${upstreamUrl}/mcp`, headers: { "x-api-key": "project-key" } };
      if (instanceId === GONE) return { upstreamUrl: `${upstreamUrl}/gone`, headers: { "x-api-key": "project-key" } };
      if (instanceId === REDIRECTING) return { upstreamUrl: `${upstreamUrl}/redirect`, headers: { "x-api-key": "project-key" } };
      throw new AuthenticationError();
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  relayBase = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v1/mcp`;
});

after(async () => {
  await app.close();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

test("POST forwards the JSON-RPC body with the provider key and without the tenant bearer", async () => {
  upstreamSeen.length = 0;
  const res = await fetch(`${relayBase}/${LIVE}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": "sess-1",
      "mcp-protocol-version": "2025-06-18",
      cookie: "leak=1",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("mcp-session-id"), "sess-1");
  assert.deepEqual(await res.json(), { echo: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  const seen = upstreamSeen[0];
  assert.equal(seen?.url, "/mcp");
  assert.equal(seen?.headers["x-api-key"], "project-key");
  assert.equal(seen?.headers["mcp-session-id"], "sess-1");
  assert.equal(seen?.headers["mcp-protocol-version"], "2025-06-18");
  assert.equal(seen?.headers.authorization, undefined);
  assert.equal(seen?.headers.cookie, undefined);
});

test("a wrong bearer is rejected before anything reaches upstream", async () => {
  upstreamSeen.length = 0;
  const res = await fetch(`${relayBase}/${LIVE}`, {
    method: "POST",
    headers: { authorization: "Bearer nope", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 401);
  assert.equal(upstreamSeen.length, 0);

  const missing = await fetch(`${relayBase}/${LIVE}`, { method: "DELETE" });
  assert.equal(missing.status, 401);
});

test("upstream 404 passes through so the client re-initializes its MCP session", async () => {
  const res = await fetch(`${relayBase}/${GONE}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 404);
});

test("GET streams server-sent events as they arrive and closes upstream when the client leaves", async () => {
  const closedBefore = upstreamClosed;
  const controller = new AbortController();
  const res = await fetch(`${relayBase}/${LIVE}`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const reader = res.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes("data: tick")) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value);
  }
  assert.match(received, /data: first/);
  assert.match(received, /data: tick/);

  controller.abort();
  await waitFor(() => upstreamClosed > closedBefore);
});

test("DELETE and Last-Event-ID cross the relay; a 3xx from upstream is not passed on", async () => {
  upstreamSeen.length = 0;
  const res = await fetch(`${relayBase}/${LIVE}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": "sess-1", "last-event-id": "42" },
  });
  assert.equal(res.status, 200);
  assert.equal(upstreamSeen[0]?.method, "DELETE");
  assert.equal(upstreamSeen[0]?.headers["last-event-id"], "42");

  const redirected = await fetch(`${relayBase}/${REDIRECTING}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(redirected.status, 502);
});

// Fastify answers 413 and closes the connection while the client is still uploading, so undici may
// see the reset before it reads the response. Either way the body was refused, which is the point;
// asserting only on the status made this test flaky.
test("bodies above the relay limit are refused", async () => {
  const oversized = "x".repeat(1024 * 1024 + 1);
  const seenBefore = upstreamSeen.length;
  let status: number | null = null;
  try {
    const res = await fetch(`${relayBase}/${LIVE}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: oversized,
    });
    status = res.status;
  } catch (err) {
    assert.match(String(err), /fetch failed/, "the only tolerated failure is the connection reset");
  }

  assert.ok(status === 413 || status === null, `expected a refusal, got ${String(status)}`);
  assert.equal(upstreamSeen.length, seenBefore, "an oversized body never reaches upstream");
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

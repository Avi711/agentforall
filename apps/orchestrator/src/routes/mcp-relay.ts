import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AuthenticationError, UpstreamUnavailableError } from "../domain/errors.js";
import type { RelayTarget } from "../services/integrations/manager.js";

const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 600;
const Param = z.object({ instanceId: z.string().uuid() });

// MCP streamable-http needs exactly these to cross the relay; everything else stays on our side.
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "mcp-session-id", "mcp-protocol-version"] as const;

export interface RelayResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: WebReadableStream<Uint8Array> | null;
}

export interface RelayRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  signal: AbortSignal;
}

// Structural so the relay can take Node's fetch, undici's fetch, or a test double.
export type RelayFetch = (url: string, init: RelayRequestInit) => Promise<RelayResponse>;

export interface McpRelayDeps {
  resolveRelay(instanceId: string, bearer: string): Promise<RelayTarget>;
  fetchImpl: RelayFetch;
}

export const mcpRelayRoutes: FastifyPluginAsync<McpRelayDeps> = async (app, deps) => {
  // Bytes in, bytes out: JSON-RPC bodies are forwarded verbatim, never parsed here.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  const targets = new WeakMap<FastifyRequest, RelayTarget>();

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/:instanceId",
    bodyLimit: MAX_BODY_BYTES,
    config: {
      skipGlobalAuth: true,
      // Keyed per bot; the global limiter has no user id here. Runs after the auth hook below.
      rateLimit: {
        max: RATE_LIMIT_PER_MINUTE,
        timeWindow: 60_000,
        keyGenerator: (request: FastifyRequest) => instanceIdOf(request) ?? request.ip,
      },
    },
    onRequest: async (request) => {
      const { instanceId } = Param.parse(request.params);
      const bearer = extractBearer(request.headers.authorization);
      if (!bearer) throw new AuthenticationError();
      targets.set(request, await deps.resolveRelay(instanceId, bearer));
    },
    handler: async (request, reply) => {
      const target = targets.get(request);
      if (!target) throw new AuthenticationError();

      const headers: Record<string, string> = {};
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      Object.assign(headers, target.headers);

      // A client that hangs up mid-stream must not leave the upstream request open.
      const controller = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });

      let upstream: RelayResponse;
      try {
        upstream = await deps.fetchImpl(target.upstreamUrl, {
          method: request.method,
          headers,
          ...(request.method === "POST" && Buffer.isBuffer(request.body) ? { body: request.body } : {}),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) return reply;
        request.log.warn({ err }, "integrations relay upstream request failed");
        throw new UpstreamUnavailableError("integrations relay");
      }
      if (upstream.status >= 300 && upstream.status < 400) {
        request.log.warn({ status: upstream.status }, "integrations relay upstream redirected");
        throw new UpstreamUnavailableError("integrations relay");
      }

      reply.status(upstream.status);
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) reply.header(name, value);
      }
      if (!upstream.body) return reply.send();
      return reply.send(Readable.fromWeb(upstream.body));
    },
  });
};

function instanceIdOf(request: FastifyRequest): string | null {
  const params = request.params;
  if (typeof params !== "object" || params === null) return null;
  const id = (params as { instanceId?: unknown }).instanceId;
  return typeof id === "string" ? id : null;
}

function extractBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

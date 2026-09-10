import type { FastifyRequest } from "fastify";

// The socket peer alone: request.ip is forgeable via X-Forwarded-For, and a URL part would let a caller mint buckets.
export function relayRateLimitKey(request: FastifyRequest): string {
  return request.socket.remoteAddress ?? request.ip;
}

import type { FastifyRequest } from "fastify";
import { z } from "zod";

export const RelayParam = z.object({ instanceId: z.string().uuid() });

// Per bot, not per peer: behind Caddy every bot arrives from the proxy's address.
export function relayRateLimitKey(request: FastifyRequest): string {
  const params = RelayParam.safeParse(request.params);
  return params.success ? params.data.instanceId : request.socket.remoteAddress ?? request.ip;
}

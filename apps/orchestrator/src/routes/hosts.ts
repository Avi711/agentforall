import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AuthenticationError } from "../domain/errors.js";
import { PRIVATE_IPV4 } from "../config.js";
import type { HostRegistrar } from "../services/host-registrar.js";

// A GCE identity token with format=full is ~1.2 KB, well past the shared bearer extractor's cap.
const MAX_ID_TOKEN_LENGTH = 4096;

const RegisterBody = z
  .object({
    address: z.string().ip({ version: "v4" }).regex(PRIVATE_IPV4, "must be a private address"),
    memoryMb: z.number().int().positive().max(4_000_000).optional(),
  })
  .strict();

export interface InternalHostRoutesDeps {
  registrar: HostRegistrar;
}

// Worker-only: skipGlobalAuth because the bearer is a Google identity token the registrar verifies itself.
export const internalHostRoutes: FastifyPluginAsync<InternalHostRoutesDeps> = async (app, { registrar }) => {
  app.post(
    "/hosts/register",
    { bodyLimit: 512, config: { skipGlobalAuth: true, rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const header = request.headers.authorization;
      const idToken = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) throw new AuthenticationError();
      const { address, memoryMb } = RegisterBody.parse(request.body);
      await registrar.register(idToken, address, memoryMb);
      return reply.status(204).send();
    },
  );
};

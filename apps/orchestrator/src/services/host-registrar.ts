import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { HostNotAllowedError, UpstreamUnavailableError, errorMessage } from "../domain/errors.js";
import type { HostRepository } from "../storage/host-repository.js";
import type { IdTokenVerifier } from "./google-identity.js";

// GCE identity tokens live an hour; a worker mints one per boot, so anything older is a replay.
const MAX_TOKEN_AGE_S = 300;

const Claims = z.object({
  iat: z.number(),
  email: z.string(),
  email_verified: z.literal(true),
  google: z.object({ compute_engine: z.object({ instance_id: z.string() }) }),
});

export class HostRegistrar {
  constructor(
    private readonly repo: HostRepository,
    private readonly verifyToken: IdTokenVerifier,
    private readonly hostByInstanceId: ReadonlyMap<string, string>,
    private readonly addressByHost: ReadonlyMap<string, string>,
    private readonly logger: FastifyBaseLogger,
    private readonly onRegistered: (hostId: string, memoryMb?: number) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async register(idToken: string, address: string, memoryMb?: number): Promise<void> {
    const claims = await this.verifiedClaims(idToken);
    const instanceId = claims.google.compute_engine.instance_id;
    const identity = { instanceId, email: claims.email };
    const hostId = this.hostByInstanceId.get(instanceId);
    if (!hostId) return this.reject("instance is not in the worker set", identity);
    if (this.now() / 1000 - claims.iat > MAX_TOKEN_AGE_S) return this.reject("token older than 5 minutes", identity);
    if (this.addressByHost.get(hostId) !== address) return this.reject("address does not match the configured address", identity);
    await this.repo.register(hostId, address, memoryMb);
    this.logger.info({ hostId, address, memoryMb: memoryMb ?? null, ...identity }, "host.registered");
    this.onRegistered(hostId, memoryMb);
  }

  private async verifiedClaims(idToken: string): Promise<z.infer<typeof Claims>> {
    let payload: unknown;
    try {
      payload = await this.verifyToken(idToken);
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) throw err;
      return this.reject(errorMessage(err), {});
    }
    const parsed = Claims.safeParse(payload);
    if (!parsed.success) return this.reject("token lacks the expected claims", {});
    return parsed.data;
  }

  private reject(reason: string, identity: { instanceId?: string; email?: string }): never {
    this.logger.warn({ ...identity, reason }, "host registration rejected");
    throw new HostNotAllowedError();
  }
}

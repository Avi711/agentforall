import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { AuthenticationError } from "../domain/errors.js";

interface HashedKey {
  hash: Buffer;
  userId: string;
}

export function createAuthHook(
  apiKeys: Record<string, string>,
  hmacSecret: Buffer,
) {
  const hashedKeys: HashedKey[] = Object.entries(apiKeys).map(
    ([key, userId]) => ({
      hash: hmac(key, hmacSecret),
      userId,
    }),
  );

  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AuthenticationError();
    }

    const token = header.slice(7);
    const tokenHash = hmac(token, hmacSecret);

    for (const entry of hashedKeys) {
      if (timingSafeEqual(tokenHash, entry.hash)) {
        request.authenticatedUserId = entry.userId;
        return;
      }
    }

    throw new AuthenticationError();
  };
}

function hmac(value: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUserId: string;
  }
}

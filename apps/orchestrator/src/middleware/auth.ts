import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { AuthenticationError } from "../domain/errors.js";
import { USER_ID_PATTERN } from "../domain/types.js";

interface HashedKey {
  hash: Buffer;
  userId: string;
  trusted: boolean;
}

export interface AuthHookOptions {
  apiKeys: Record<string, string>;
  serviceTokens: string[];
  hmacSecret: Buffer;
}

// Two modes: API_KEYS bearer maps 1:1 to a user; SERVICE_TOKENS bearer impersonates via X-Act-As-User.
export function createAuthHook(options: AuthHookOptions) {
  const hashedApiKeys: HashedKey[] = Object.entries(options.apiKeys).map(
    ([key, userId]) => ({
      hash: hmac(key, options.hmacSecret),
      userId,
      trusted: false,
    }),
  );
  const hashedServiceTokens: HashedKey[] = options.serviceTokens.map((key) => ({
    hash: hmac(key, options.hmacSecret),
    userId: "__service__",
    trusted: true,
  }));

  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AuthenticationError();
    }

    const token = header.slice(7);
    const tokenHash = hmac(token, options.hmacSecret);

    for (const entry of hashedApiKeys) {
      if (timingSafeEqual(tokenHash, entry.hash)) {
        request.authenticatedUserId = entry.userId;
        return;
      }
    }

    for (const entry of hashedServiceTokens) {
      if (timingSafeEqual(tokenHash, entry.hash)) {
        const actAs = request.headers["x-act-as-user"];
        if (typeof actAs !== "string" || !USER_ID_PATTERN.test(actAs)) {
          throw new AuthenticationError();
        }
        request.authenticatedUserId = actAs;
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

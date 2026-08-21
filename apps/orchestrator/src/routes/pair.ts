import { z } from "zod";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { InstanceManager } from "../services/instance-manager.js";
import type { PairingManager } from "../services/pairing-manager.js";

const UuidParam = z.object({ id: z.string().uuid() });

// E.164 strict — local format passes the sidecar but WhatsApp later rejects the code.
const PhoneBody = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{9,14}$/, "phone must be E.164 (country code + number, 10–15 digits)"),
});

// Cap length so a rogue sidecar can't write unbounded strings.
const ACCOUNT_ID_RE = /^[A-Za-z0-9@._+:-]{1,128}$/;
const MAX_CREDS_BYTES = 8 * 1024 * 1024;

export interface PairRoutesDeps {
  manager: InstanceManager;
  pairingManager: PairingManager;
}

export const pairingRoutes: FastifyPluginAsync<PairRoutesDeps> = async (
  app,
  deps,
) => {
  const { manager, pairingManager } = deps;

  app.post("/:id/pair", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const inst = await manager.ensureWhatsappChannel(id, request.authenticatedUserId);
    const result = await pairingManager.startPairing(inst);
    return reply.send(result);
  });

  app.post("/:id/whatsapp/disconnect", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.disconnectWhatsapp(id, request.authenticatedUserId);
    return reply.status(204).send();
  });

  app.post("/:id/pair/cancel", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.get(id, request.authenticatedUserId);
    await pairingManager.cancelPairing(id, "user_cancelled");
    return reply.status(204).send();
  });

  app.get("/:id/pair/qr", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    await manager.get(id, request.authenticatedUserId);
    const res = await pairingManager.proxyToSidecar(id, "/pair/qr", {
      method: "GET",
    });
    return sendProxyResponse(reply, res);
  });

  app.post("/:id/pair/code", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const body = PhoneBody.parse(request.body);
    await manager.get(id, request.authenticatedUserId);
    const res = await pairingManager.proxyToSidecar(id, "/pair/code", {
      method: "POST",
      body,
    });
    return sendProxyResponse(reply, res);
  });

  app.get("/:id/pair/status", async (request, reply) => {
    const { id } = UuidParam.parse(request.params);
    const inst = await manager.get(id, request.authenticatedUserId);

    // Try the sidecar first (has QR/code availability). Fall back to DB-only status.
    try {
      const res = await pairingManager.proxyToSidecar(id, "/pair/status", {
        method: "GET",
      });
      if (res.status === 200 && isStatusPayload(res.body)) {
        return reply.send({
          ...res.body,
          pairingStatus: inst.pairingStatus,
          whatsappAccountId: inst.whatsappAccountId,
        });
      }
    } catch {
      // Sidecar not reachable — fall back to DB
    }

    return reply.send({
      phase: inst.pairingStatus === "paired" ? "authenticated" : "idle",
      pairingStatus: inst.pairingStatus,
      whatsappAccountId: inst.whatsappAccountId,
      qrAvailable: false,
      codeAvailable: false,
    });
  });
};

export interface InternalPairRoutesDeps {
  pairingManager: PairingManager;
}

// Sidecar-only. skipGlobalAuth bypasses the bearer hook; in-handler timing-safe compare against the per-pair session token.
export const internalPairRoutes: FastifyPluginAsync<InternalPairRoutesDeps> = async (
  app,
  deps,
) => {
  const { pairingManager } = deps;

  app.post<{ Params: { id: string } }>(
    "/pair/:id/completed",
    {
      bodyLimit: MAX_CREDS_BYTES,
      config: { skipGlobalAuth: true },
    },
    async (request, reply) => {
      const { id } = UuidParam.parse(request.params);
      const token = extractBearer(request.headers.authorization);

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.status(400).send({
          code: "EMPTY_BODY",
          message: "request body is required",
        });
      }

      const accountId = parseAccountIdHeader(request.headers["x-account-id"]);

      await pairingManager.completePairingCallback(id, token, body, accountId);
      return reply.status(204).send();
    },
  );
};

function extractBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (token.length === 0 || token.length > 256) return null;
  return token;
}

function parseAccountIdHeader(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (!ACCOUNT_ID_RE.test(value)) return null;
  return value;
}

// Clamp sidecar status codes to a known safe set; unknown → 502.
const ALLOWED_PROXY_STATUSES = new Set([200, 400, 404, 409, 425, 500]);
function clampUpstreamStatus(status: number): number {
  return ALLOWED_PROXY_STATUSES.has(status) ? status : 502;
}

function sendProxyResponse(
  reply: FastifyReply,
  res: { status: number; body: unknown },
) {
  const status = clampUpstreamStatus(res.status);
  if (status >= 400) {
    return reply.status(status).send(normalizeProxyError(res.body));
  }
  return reply.status(status).send(res.body);
}

function normalizeProxyError(body: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (isStandardError(body)) return body;
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error: unknown }).error;
    return {
      code: typeof error === "string" ? error.toUpperCase() : "UPSTREAM_ERROR",
      message: typeof error === "string" ? error : "upstream request failed",
      details: body,
    };
  }
  return {
    code: "UPSTREAM_ERROR",
    message: "upstream request failed",
    details: body,
  };
}

function isStandardError(
  body: unknown,
): body is { code: string; message: string; details?: unknown } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string" &&
    typeof (body as { message?: unknown }).message === "string"
  );
}

function isStatusPayload(
  value: unknown,
): value is { phase: string; [k: string]: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { phase: unknown }).phase === "string"
  );
}

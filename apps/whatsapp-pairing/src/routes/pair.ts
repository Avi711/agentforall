import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import type { BaileysSession, PairingState } from "../baileys-session.js";
import { PhoneBodySchema } from "./schemas.js";

interface PairRoutesOptions {
  session: BaileysSession;
}

interface PairStatusBody {
  phase: PairingState["phase"];
  accountId: string | null;
  reason: string | null;
  qrAvailable: boolean;
  codeAvailable: boolean;
  qrExpiresAt: string | null;
  codeExpiresAt: string | null;
  updatedAt: string;
}

function toStatusBody(state: PairingState): PairStatusBody {
  return {
    phase: state.phase,
    accountId: state.accountId ?? null,
    reason: state.reason ?? null,
    qrAvailable: Boolean(state.qr) && state.phase === "awaiting_qr",
    codeAvailable: Boolean(state.pairingCode) && state.phase === "awaiting_code",
    qrExpiresAt: state.qrExpiresAt?.toISOString() ?? null,
    codeExpiresAt: state.pairingCodeExpiresAt?.toISOString() ?? null,
    updatedAt: state.updatedAt.toISOString(),
  };
}

export async function registerPairRoutes(
  app: FastifyInstance,
  opts: PairRoutesOptions,
): Promise<void> {
  const { session } = opts;

  app.get("/pair/qr", async (_req, reply) => {
    const state = session.getState();
    if (state.phase === "authenticated") {
      return reply.code(409).send({ error: "already_authenticated" });
    }
    if (!state.qr) {
      return reply.code(425).send({ error: "qr_not_ready" });
    }
    const dataUrl = await QRCode.toDataURL(state.qr, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });
    return reply.send({
      dataUrl,
      raw: state.qr,
      expiresAt: state.qrExpiresAt?.toISOString(),
    });
  });

  app.post("/pair/code", async (req, reply) => {
    const parsed = PhoneBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
    }
    try {
      const code = await session.requestPairingCode(parsed.data.phone);
      const state = session.getState();
      return reply.send({
        code,
        expiresAt: state.pairingCodeExpiresAt?.toISOString(),
      });
    } catch (err) {
      req.log.warn({ err }, "pair code request failed");
      return reply.code(400).send({
        error: "pair_code_failed",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  });

  app.get("/pair/status", async (_req, reply) => {
    return reply.send(toStatusBody(session.getState()));
  });
}

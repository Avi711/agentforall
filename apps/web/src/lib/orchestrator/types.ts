import { z } from "zod";

const IsoDate = z.string().datetime();

export const InstanceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  displayName: z.string(),
  status: z.enum([
    "provisioning",
    "running",
    "degraded",
    "unhealthy",
    "stopped",
    "destroying",
    "destroyed",
    "error",
  ]),
  containerName: z.string(),
  containerId: z.string().nullable(),
  gatewayPort: z.number().int(),
  healthFailures: z.number().int(),
  errorMessage: z.string().nullable(),
  pairingStatus: z.enum([
    "none",
    "awaiting_qr",
    "awaiting_code",
    "paired",
    "expired",
    "failed",
  ]),
  whatsappAccountId: z.string().nullable(),
  hasWhatsappCreds: z.boolean(),
  lastSeenAt: IsoDate.nullable().optional(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  stoppedAt: IsoDate.nullable().optional(),
  destroyedAt: IsoDate.nullable().optional(),
  config: z.object({
    displayName: z.string(),
    provider: z
      .object({
        name: z.string(),
        model: z.string(),
      })
      .passthrough(),
    channels: z.array(z.object({ type: z.string() }).passthrough()),
  }).passthrough(),
});

export type Instance = z.infer<typeof InstanceSchema>;

export const StartPairingResultSchema = z.object({
  status: z.enum(["started", "already_active"]),
  expiresInMs: z.number().int(),
});
export type StartPairingResult = z.infer<typeof StartPairingResultSchema>;

export const PairQrSchema = z.object({
  dataUrl: z.string().startsWith("data:image/png;base64,"),
  raw: z.string(),
  expiresAt: IsoDate.optional(),
});
export type PairQr = z.infer<typeof PairQrSchema>;

export const PairCodeSchema = z.object({
  code: z.string().min(4),
  expiresAt: IsoDate.optional(),
});
export type PairCode = z.infer<typeof PairCodeSchema>;

export const PairStatusSchema = z.object({
  phase: z.enum([
    "idle",
    "awaiting_qr",
    "awaiting_code",
    "authenticating",
    "authenticated",
    "failed",
  ]),
  pairingStatus: z.enum([
    "none",
    "awaiting_qr",
    "awaiting_code",
    "paired",
    "expired",
    "failed",
  ]),
  whatsappAccountId: z.string().nullable(),
  qrAvailable: z.boolean(),
  codeAvailable: z.boolean(),
  qrExpiresAt: IsoDate.nullable().optional(),
  codeExpiresAt: IsoDate.nullable().optional(),
  accountId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  updatedAt: IsoDate.optional(),
});
export type PairStatus = z.infer<typeof PairStatusSchema>;

export interface CreateInstanceInput {
  displayName: string;
}

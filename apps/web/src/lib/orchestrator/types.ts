import { z } from "zod";

const IsoDate = z.string().datetime();

export const InstanceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  displayName: z.string(),
  // Display-only on the web, so unknown future runtimes must not break parsing.
  runtimeKind: z.string().min(1),
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
  // Only on the detail endpoint while provisioning; the last stage the orchestrator recorded.
  // Kept as a string so a newer orchestrator stage never breaks parsing; see isProvisioningStage.
  provisioningStage: z.string().nullable().optional(),
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

export const PROVISIONING_STAGES = ["reserved", "container_created", "backup_restored", "started", "running"] as const;
export type ProvisioningStage = (typeof PROVISIONING_STAGES)[number];

export function isProvisioningStage(value: unknown): value is ProvisioningStage {
  return typeof value === "string" && (PROVISIONING_STAGES as readonly string[]).includes(value);
}

export const BotUsageSchema = z.discriminatedUnion("supported", [
  z.object({
    supported: z.literal(true),
    spendCents: z.number().int().min(0),
    maxBudgetCents: z.number().int().min(0).nullable(),
    budgetDuration: z.string().nullable(),
    budgetResetAt: z.string().nullable(),
    keyAlias: z.string().nullable(),
    models: z.array(z.string()),
    updatedAt: IsoDate,
  }),
  z.object({
    supported: z.literal(false),
    reason: z.literal("not_litellm"),
  }),
]);
export type BotUsage = z.infer<typeof BotUsageSchema>;

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

export const TelegramLinkSchema = z.object({
  deepLink: z.string().url(),
  botUsername: z.string(),
  expiresAt: IsoDate,
});
export type TelegramLink = z.infer<typeof TelegramLinkSchema>;

export const TelegramLinkStatusSchema = z.object({
  status: z.enum(["none", "pending", "connected"]),
  botUsername: z.string().nullable(),
  deepLink: z.string().url().nullable(),
});
export type TelegramLinkStatus = z.infer<typeof TelegramLinkStatusSchema>;

export const WHATSAPP_DM_ACCESS = ["owner", "open"] as const;
export type WhatsappDmAccess = (typeof WHATSAPP_DM_ACCESS)[number];

export const WhatsappAccessSchema = z.object({
  botNumber: z.string().nullable(),
  ownerNumber: z.string().nullable(),
  access: z.enum(WHATSAPP_DM_ACCESS),
  configured: z.boolean(),
  claiming: z.boolean(),
});
export type WhatsappAccess = z.infer<typeof WhatsappAccessSchema>;

export interface WhatsappAccessUpdate {
  access: WhatsappDmAccess;
}

export const OWNER_SYNC_STATES = ["applied", "pending", "unavailable"] as const;
export type OwnerSyncState = (typeof OWNER_SYNC_STATES)[number];

export const OwnerIdentitySchema = z.object({
  telegram: z.object({ userId: z.string(), botUsername: z.string().nullable() }).nullable(),
  whatsappNumber: z.string().nullable(),
  sync: z.enum(OWNER_SYNC_STATES),
  candidates: z.array(
    z.object({
      number: z.string(),
      code: z.string(),
      name: z.string().nullable(),
      requestedAt: z.string(),
    }),
  ),
  candidatesUnavailable: z.boolean(),
});
export type OwnerIdentity = z.infer<typeof OwnerIdentitySchema>;
export type OwnerCandidate = OwnerIdentity["candidates"][number];

export interface OwnerIdentityUpdate {
  whatsappNumber: string | null;
}

export const AdminInstanceSchema = z.object({
  instance: InstanceSchema,
  // null = usage lookup failed for that bot; the overview still renders.
  usage: BotUsageSchema.nullable(),
});
export type AdminInstance = z.infer<typeof AdminInstanceSchema>;

export const BOT_CHANNELS = ["telegram", "whatsapp"] as const;
export type BotChannel = (typeof BOT_CHANNELS)[number];

export interface CreateInstanceInput {
  displayName: string;
  channel: BotChannel;
}

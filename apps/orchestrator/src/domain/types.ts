import { z } from "zod";
import {
  AGENT_RUNTIME_KINDS,
  BACKUP_IMPORT_STATUSES,
  INSTANCE_STATUSES,
  PAIRING_STATUSES,
} from "@agent-forall/db";

export { AGENT_RUNTIME_KINDS, BACKUP_IMPORT_STATUSES, INSTANCE_STATUSES, PAIRING_STATUSES };
export type AgentRuntimeKind = (typeof AGENT_RUNTIME_KINDS)[number];
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];
export type PairingStatus = (typeof PAIRING_STATUSES)[number];
export type BackupImportStatus = (typeof BACKUP_IMPORT_STATUSES)[number];

export const VALID_TRANSITIONS: Record<InstanceStatus, readonly InstanceStatus[]> = {
  provisioning: ["running", "error"],
  running: ["degraded", "unhealthy", "stopped", "destroying"],
  degraded: ["running", "unhealthy", "stopped", "destroying"],
  unhealthy: ["running", "degraded", "stopped", "destroying"],
  stopped: ["running", "destroying"],
  destroying: ["destroyed", "error"],
  destroyed: [],
  error: ["destroying"],
};

export function isValidTransition(from: InstanceStatus, to: InstanceStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export const LLM_PROVIDERS = ["anthropic", "openai", "openrouter", "gemini", "litellm"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const MODEL_INPUT_CAPABILITIES = ["text", "image"] as const;
export type ModelInputCapability = (typeof MODEL_INPUT_CAPABILITIES)[number];

export const PROVIDER_MEDIA_CAPABILITIES = ["image", "audio", "video", "pdf"] as const;
export type ProviderMediaCapability = (typeof PROVIDER_MEDIA_CAPABILITIES)[number];

export const CHANNEL_TYPES = ["telegram", "discord", "slack", "whatsapp"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CONTAINER_UP_STATUSES = ["running", "degraded", "unhealthy"] as const;
export function isContainerUp(status: InstanceStatus): boolean {
  return (CONTAINER_UP_STATUSES as readonly InstanceStatus[]).includes(status);
}

export const WHATSAPP_DM_ACCESS = ["owner", "open"] as const;
export type WhatsappDmAccess = (typeof WHATSAPP_DM_ACCESS)[number];

// Telegram without botToken means the channel is awaiting a Managed Bots link.
// WhatsApp dmAccess undefined = legacy open; "owner" without ownerNumber = claim (pairing) mode.
export type ChannelConfig =
  | {
      type: "telegram";
      botToken?: string;
      botUsername?: string;
      botId?: number;
      dmPolicy?: "pairing" | "open" | "allowlist";
      allowFrom?: string[];
    }
  | { type: "discord"; token: string; guildId?: string }
  | { type: "slack"; botToken: string; appToken: string }
  | { type: "whatsapp"; ownerNumber?: string; dmAccess?: WhatsappDmAccess };

export type WhatsappChannelConfig = Extract<ChannelConfig, { type: "whatsapp" }>;
export type TelegramChannelConfig = Extract<ChannelConfig, { type: "telegram" }>;

export interface ProviderConfig {
  name: LlmProvider;
  id?: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  input?: ModelInputCapability[];
  media?: ProviderMediaCapability[];
  fallbacks?: string[];
}

export interface ResourceLimits {
  memoryMb: number;
  cpuShares: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  memoryMb: 4096,
  cpuShares: 512,
};

export interface InstanceConfig {
  displayName: string;
  provider: ProviderConfig;
  channels: ChannelConfig[];
  resources: ResourceLimits;
}

export const InstanceConfigSchema: z.ZodType<InstanceConfig> = z.object({
  displayName: z.string(),
  provider: z.object({
    name: z.enum(LLM_PROVIDERS),
    id: z.string().optional(),
    apiKey: z.string(),
    model: z.string(),
    baseUrl: z.string().url().optional(),
    input: z.array(z.enum(MODEL_INPUT_CAPABILITIES)).optional(),
    media: z.array(z.enum(PROVIDER_MEDIA_CAPABILITIES)).optional(),
    fallbacks: z.array(z.string()).optional(),
  }),
  channels: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("telegram"),
        botToken: z.string().optional(),
        botUsername: z.string().optional(),
        botId: z.number().int().optional(),
        dmPolicy: z.enum(["pairing", "open", "allowlist"]).optional(),
        allowFrom: z.array(z.string()).optional(),
      }),
      z.object({ type: z.literal("discord"), token: z.string(), guildId: z.string().optional() }),
      z.object({ type: z.literal("slack"), botToken: z.string(), appToken: z.string() }),
      z.object({
        type: z.literal("whatsapp"),
        ownerNumber: z.string().optional(),
        dmAccess: z.enum(WHATSAPP_DM_ACCESS).optional(),
      }),
    ]),
  ),
  resources: z.object({
    memoryMb: z.number(),
    cpuShares: z.number(),
  }),
});

export interface ConfigPatch {
  displayName?: string;
  provider?: Partial<ProviderConfig>;
  channels?: ChannelConfig[];
  resources?: Partial<ResourceLimits>;
}

export interface CreateInstanceInput {
  displayName: string;
  provider?: ProviderConfig;
  channels: ChannelConfig[];
  resources?: Partial<ResourceLimits>;
  backupImport?: BackupImportRef;
}

export interface BackupImportRef {
  objectName: string;
  contentLength: number;
  contentType: string;
}

export interface InstanceBackupImport {
  status: BackupImportStatus;
  objectName: string | null;
  contentLength: number | null;
  contentType: string | null;
}

export interface InstanceLiteLlm {
  keyAlias: string | null;
  keyHash: string | null;
  budgetCents: number | null;
  budgetDuration: string | null;
}

export type BotUsage =
  | {
      supported: true;
      spendCents: number;
      maxBudgetCents: number | null;
      budgetDuration: string | null;
      budgetResetAt: string | null;
      keyAlias: string | null;
      models: string[];
      updatedAt: string;
    }
  | {
      supported: false;
      reason: "not_litellm";
    };

export interface Instance {
  id: string;
  userId: string;
  hostId: string;
  runtimeKind: AgentRuntimeKind;
  displayName: string;
  status: InstanceStatus;
  config: InstanceConfig;
  containerId: string | null;
  containerName: string;
  gatewayPort: number;
  gatewayToken: string;
  healthFailures: number;
  errorMessage: string | null;
  pairingStatus: PairingStatus;
  whatsappAccountId: string | null;
  hasWhatsappCreds: boolean;
  lastSeenAt: Date | null;
  backupImport: InstanceBackupImport;
  litellm: InstanceLiteLlm;
  createdAt: Date;
  updatedAt: Date;
  stoppedAt: Date | null;
  destroyedAt: Date | null;
}

// Narrow — rejects anything that could slip into a log line or container label.
export const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

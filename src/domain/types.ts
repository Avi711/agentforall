import { z } from "zod";

export const INSTANCE_STATUSES = [
  "provisioning",
  "running",
  "degraded",
  "unhealthy",
  "stopped",
  "destroying",
  "destroyed",
  "error",
] as const;

export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

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

export const LLM_PROVIDERS = ["anthropic", "openai", "openrouter", "gemini"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const CHANNEL_TYPES = ["telegram", "discord", "slack", "whatsapp"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export type ChannelConfig =
  | { type: "telegram"; botToken: string; dmPolicy?: "pairing" | "open" | "allowlist" }
  | { type: "discord"; token: string; guildId?: string }
  | { type: "slack"; botToken: string; appToken: string }
  | { type: "whatsapp" };

export interface ProviderConfig {
  name: LlmProvider;
  apiKey: string;
  model: string;
  fallbacks?: string[];
}

export interface ResourceLimits {
  memoryMb: number;
  cpuShares: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  memoryMb: 512,
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
    apiKey: z.string(),
    model: z.string(),
    fallbacks: z.array(z.string()).optional(),
  }),
  channels: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("telegram"), botToken: z.string(), dmPolicy: z.enum(["pairing", "open", "allowlist"]).optional() }),
      z.object({ type: z.literal("discord"), token: z.string(), guildId: z.string().optional() }),
      z.object({ type: z.literal("slack"), botToken: z.string(), appToken: z.string() }),
      z.object({ type: z.literal("whatsapp") }),
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
  provider: ProviderConfig;
  channels: ChannelConfig[];
  resources?: Partial<ResourceLimits>;
}

export interface Instance {
  id: string;
  userId: string;
  displayName: string;
  status: InstanceStatus;
  config: InstanceConfig;
  containerId: string | null;
  containerName: string;
  gatewayPort: number;
  gatewayToken: string;
  healthFailures: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  stoppedAt: Date | null;
  destroyedAt: Date | null;
}

export const USER_ID_PATTERN = /^[a-zA-Z0-9_\-:.]{1,128}$/;

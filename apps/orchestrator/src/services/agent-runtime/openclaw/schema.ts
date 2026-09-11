export interface OpenclawConfig {
  agents: {
    defaults: {
      model: ModelSelection;
      imageModel?: ModelSelection;
      pdfModel?: ModelSelection;
      workspace: string;
      maxConcurrent: number;
      heartbeat: HeartbeatConfig;
    };
    entries: Record<string, AgentEntryConfig>;
  };
  models?: ModelsConfig;
  channels: ChannelsConfig;
  tools?: ToolsConfig;
  gateway: {
    port: number;
    mode: "local";
    bind: "lan" | "loopback";
    auth: { mode: "token"; token: string };
  };
  plugins?: { entries: Record<string, PluginEntryConfig> };
  browser?: BrowserConfig;
  session: SessionConfig;
  commands?: CommandsConfig;
  mcp?: { servers: Record<string, McpServerConfig> };
}

export interface AgentEntryConfig {
  identity?: { name?: string; emoji?: string };
}

export interface HeartbeatConfig {
  every: string;
  activeHours?: { start: string; end: string; timezone?: string };
  isolatedSession?: boolean;
  target?: "owner" | "last" | "none";
  directPolicy?: "allow" | "block";
}

export interface PluginEntryConfig {
  enabled: boolean;
  hooks?: { allowConversationAccess?: boolean; timeoutMs?: number };
  config?: { dreaming?: { enabled: boolean } };
}

export interface McpServerConfig {
  transport: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export interface CommandsConfig {
  // Cross-channel owner ids ("telegram:123", "whatsapp:+9725…"); gates owner-only commands and approvals.
  ownerAllowFrom: string[];
}

export interface SessionConfig {
  dmScope: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  // canonical id → channel-prefixed peer ids ("telegram:123", "whatsapp:+9725…").
  identityLinks?: Record<string, string[]>;
}

export interface ModelSelection {
  primary: string;
  fallbacks?: string[];
}

export interface ModelsConfig {
  mode?: "merge" | "replace";
  providers: Record<string, ModelProviderConfig>;
}

export interface ModelProviderConfig {
  api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  baseUrl?: string;
  apiKey?: string;
  models: ModelDefinition[];
  timeoutSeconds?: number;
}

export interface ModelDefinition {
  id: string;
  name?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  compat?: { supportsUsageInStreaming?: boolean };
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface ToolsConfig {
  media?: MediaToolsConfig;
  exec?: { security: "deny" | "allowlist" | "full" };
  // Per-sender policy; first matching key wins, "*" is everyone else. Cannot grant back global denials.
  toolsBySender?: Record<string, SenderToolPolicy>;
}

export interface SenderToolPolicy {
  alsoAllow?: string[];
  deny?: string[];
}

export interface MediaToolsConfig {
  concurrency?: number;
  models: MediaModelEntry[];
  image?: MediaToolConfig;
  audio?: MediaToolConfig;
  video?: MediaToolConfig;
}

export interface MediaToolConfig {
  enabled: boolean;
  // "<provider>/<model>", matched against `models`.
  preferredModel: string;
  maxBytes?: number;
  timeoutSeconds?: number;
}

export interface MediaModelEntry {
  provider: string;
  model: string;
  baseUrl?: string;
  capabilities: MediaCapability[];
  timeoutSeconds?: number;
}

export type MediaCapability = "image" | "audio" | "video";

export interface BrowserConfig {
  headless?: boolean;
  noSandbox?: boolean;
}

export interface ChannelsConfig {
  whatsapp?: WhatsAppChannelConfig;
  whatsapp_cloud?: WhatsAppCloudChannelConfig;
  telegram?: {
    enabled: boolean;
    botToken: string;
    dmPolicy?: "open" | "allowlist" | "pairing";
    allowFrom?: string[];
    errorPolicy?: "always" | "once" | "silent";
    streaming?: { mode: "off" | "partial" | "block" | "progress" };
    groupPolicy?: "open" | "allowlist" | "disabled";
    // Chat id → per-group settings; "*" matches any group.
    groups?: Record<string, { requireMention?: boolean }>;
  };
  discord?: {
    enabled: boolean;
    token: string;
    groupPolicy?: string;
    guilds?: Record<string, unknown>;
  };
  slack?: { enabled: boolean; botToken: string; appToken: string };
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  dmPolicy: "open" | "allowlist" | "pairing";
  allowFrom?: string[];
  defaultAccount: string;
  accounts: Record<string, WhatsAppAccountConfig>;
  actions?: { sendMessage?: boolean; reactions?: boolean; polls?: boolean };
}

export interface WhatsAppAccountConfig {
  enabled: boolean;
  authDir: string;
}

// Our channel plugin's block; secrets stay in .env, these are what it needs to name and route itself.
export interface WhatsAppCloudChannelConfig {
  enabled: boolean;
  dmPolicy: "open";
  allowFrom: string[];
  defaultAccount: string;
  accounts: Record<string, WhatsAppCloudAccountConfig>;
}

export interface WhatsAppCloudAccountConfig {
  enabled: boolean;
  phoneNumberId: string;
  displayPhoneNumber: string;
  relayUrl: string;
}

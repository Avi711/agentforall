export interface OpenclawConfig {
  agents: {
    defaults: {
      model: ModelSelection;
      imageModel?: ModelSelection;
      pdfModel?: ModelSelection;
      workspace: string;
      maxConcurrent: number;
    };
    list: { id: string; default?: boolean }[];
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
  plugins?: {
    entries: Record<
      string,
      { enabled: boolean; hooks?: { allowConversationAccess?: boolean; timeoutMs?: number } }
    >;
  };
  browser?: BrowserConfig;
  logging: { redactSensitive: "tools" | "all" | "none" };
  web?: WebConfig;
  session: SessionConfig;
  commands?: CommandsConfig;
  mcp?: { servers: Record<string, McpServerConfig> };
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
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface ToolsConfig {
  media?: MediaToolsConfig;
}

export interface MediaToolsConfig {
  concurrency?: number;
  image?: MediaToolConfig;
  audio?: MediaToolConfig;
  video?: MediaToolConfig;
}

export interface MediaToolConfig {
  enabled: boolean;
  maxBytes?: number;
  timeoutSeconds?: number;
  models: MediaModelEntry[];
}

export interface MediaModelEntry {
  provider: string;
  model: string;
  baseUrl?: string;
  capabilities?: ("image" | "audio" | "video")[];
  timeoutSeconds?: number;
}

export interface BrowserConfig {
  headless?: boolean;
  noSandbox?: boolean;
}

export interface WebConfig {
  whatsapp?: {
    keepAliveIntervalMs?: number;
    connectTimeoutMs?: number;
    defaultQueryTimeoutMs?: number;
  };
  reconnect?: {
    initialMs?: number;
    maxMs?: number;
    factor?: number;
    jitter?: number;
    maxAttempts?: number;
  };
}

export interface ChannelsConfig {
  whatsapp?: WhatsAppChannelConfig;
  telegram?: {
    enabled: boolean;
    botToken: string;
    dmPolicy?: "open" | "allowlist" | "pairing";
    allowFrom?: string[];
    errorPolicy?: "always" | "once" | "silent";
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

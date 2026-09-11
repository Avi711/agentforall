import { isDeepStrictEqual } from "node:util";
import tar from "tar-stream";
import { CHANNEL_TYPES } from "../../../domain/types.js";
import type {
  ChannelType,
  InstanceConfig,
  LlmProvider,
  ProviderConfig,
  WhatsappChannelConfig,
  WhatsappCloudChannelConfig,
} from "../../../domain/types.js";
import { findWhatsappCloudChannel } from "../../../domain/channels.js";
import { ownerIdentityOf, ownerPeerIds } from "../../../domain/owner.js";
import type { RuntimeConfigFiles } from "../types.js";
import {
  OPENCLAW_INTERNAL_PORT,
  OPENCLAW_USER,
  OPENCLAW_WHATSAPP_SESSION_PATH,
  OPENCLAW_WORKSPACE_PATH,
} from "./constants.js";
import type {
  ChannelsConfig,
  HeartbeatConfig,
  MediaCapability,
  MediaModelEntry,
  MediaToolsConfig,
  OpenclawConfig,
  SenderToolPolicy,
  SessionConfig,
  ToolsConfig,
  WhatsAppChannelConfig,
} from "./schema.js";

const PROVIDER_ENV_KEY: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  litellm: "LITELLM_API_KEY",
};

const CREDIT_PLUGIN_ID = "agentforall-credit";
const CREDIT_HOOK_TIMEOUT_MS = 3000;
// OpenClaw transcribes only with a plugin-backed provider, so a bot behind our gateway needs this
// one; it registers under the same id and calls the model the bot already replies with.
const MEDIA_PLUGIN_ID = "agentforall-media";
const MEDIA_ENV_KEY = "AGENTFORALL_MEDIA_API_KEY";
const MEMORY_PLUGIN_ID = "memory-core";
const MAIN_AGENT_ID = "main";
export const MCP_RELAY_SERVER_NAME = "agentforall";
export const WHATSAPP_CLOUD_PLUGIN_ID = "agentforall-whatsapp-cloud";
export const WHATSAPP_CLOUD_CHANNEL_ID = "whatsapp_cloud";
export const WHATSAPP_CLOUD_RELAY_TOKEN_ENV = "WHATSAPP_CLOUD_RELAY_TOKEN";
// Tools our plugin registers; the escalation is the one thing a customer session may do.
export const WHATSAPP_CLOUD_ESCALATE_TOOL = "whatsapp_cloud_escalate";
export const WHATSAPP_CLOUD_HANDOFF_TOOL = "whatsapp_cloud_handoff";
export const WHATSAPP_CLOUD_REPLY_TOOL = "whatsapp_cloud_reply";
// Every 2026.8.2 group, every MCP server ("bundle-mcp") and the plugin tools by name: "group:plugins" would deny the escalation too.
export const STRANGER_TOOL_POLICY: SenderToolPolicy = {
  deny: [
    "group:runtime",
    "group:fs",
    "group:sessions",
    "group:messaging",
    "group:automation",
    "group:web",
    "group:ui",
    "group:media",
    "group:agents",
    "group:nodes",
    "group:memory",
    "group:openclaw",
    "bundle-mcp",
    `${MCP_RELAY_SERVER_NAME}__*`,
    "intent",
    WHATSAPP_CLOUD_HANDOFF_TOOL,
    WHATSAPP_CLOUD_REPLY_TOOL,
  ],
  alsoAllow: [WHATSAPP_CLOUD_ESCALATE_TOOL],
};
const TENANT_TIMEZONE = "Asia/Jerusalem";

// The 2026.8 default is a full main-session turn every 30 minutes (~100K tokens each). A few
// isolated check-ins in waking hours keep the proactive behaviour at a fraction of the spend.
const HEARTBEAT: HeartbeatConfig = {
  every: "8h",
  activeHours: { start: "08:00", end: "22:00", timezone: TENANT_TIMEZONE },
  isolatedSession: true,
  target: "owner",
  // Explicit: doctor flags an owner-targeted heartbeat whose direct-message policy is left implicit.
  directPolicy: "allow",
};

const OPENCLAW_PROVIDER_PREFIX: Record<LlmProvider, string> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  gemini: "google",
  litellm: "litellm",
};

export function generateOpenclawFiles(
  config: InstanceConfig,
  gatewayToken: string,
): RuntimeConfigFiles {
  return {
    configJson: generateOpenclawConfig(config, gatewayToken),
    dotEnv: generateOpenclawEnv(config, gatewayToken),
  };
}

// The container owns its config file: the tenant edits it and the runtime writes to it. Only the
// fields the dashboard renders belong to us, so a change sets exactly those paths on the live
// config and leaves everything else — group allowlists, mcp servers, hand edits — as it found them.
export function generateRuntimePatchedOpenclawFiles(
  existingConfigJson: string,
  config: InstanceConfig,
  gatewayToken: string,
): RuntimeConfigFiles {
  const live = parseJsonRecord(existingConfigJson);
  const generated = parseJsonRecord(generateOpenclawConfig(config, gatewayToken));
  const patched = structuredClone(live);
  for (const path of ownedPaths(generated, live)) {
    setPath(patched, path, readPath(generated, path));
  }
  return {
    configJson: JSON.stringify(patched, null, 2),
    dotEnv: generateOpenclawEnv(config, gatewayToken),
  };
}

export async function buildOpenclawEnvTar(dotEnv: string): Promise<Buffer> {
  return packTar(async (pack) => {
    await writeEntry(pack, {
      name: ".openclaw/",
      type: "directory",
      mode: 0o700,
      ...OPENCLAW_USER,
    });
    await writeEntry(pack, { name: ".openclaw/.env", mode: 0o600, ...OPENCLAW_USER }, dotEnv);
  });
}

export async function buildOpenclawWorkspaceFileTar(fileName: string, content: string): Promise<Buffer> {
  return packTar(async (pack) => {
    await writeEntry(pack, { name: ".openclaw/", type: "directory", mode: 0o700, ...OPENCLAW_USER });
    await writeEntry(pack, { name: ".openclaw/workspace/", type: "directory", mode: 0o700, ...OPENCLAW_USER });
    await writeEntry(pack, { name: `.openclaw/workspace/${fileName}`, mode: 0o644, ...OPENCLAW_USER }, content);
  });
}

export async function buildOpenclawConfigTar(
  files: RuntimeConfigFiles,
): Promise<Buffer> {
  return packTar(async (pack) => {
    const owner = OPENCLAW_USER;
    await writeEntry(pack, {
      name: ".openclaw/",
      type: "directory",
      mode: 0o700,
      ...owner,
    });
    await writeEntry(
      pack,
      { name: ".openclaw/openclaw.json", mode: 0o644, ...owner },
      files.configJson,
    );
    await writeEntry(
      pack,
      { name: ".openclaw/.env", mode: 0o600, ...owner },
      files.dotEnv,
    );
  });
}

// The runtime stamps its own bookkeeping key on every write, so that one is ignored; everything
// else is orchestrator-rendered and must match for the config to count as in place.
export function configMatches(liveConfigJson: string, desiredConfigJson: string): boolean {
  try {
    return isDeepStrictEqual(
      withoutRuntimeStamp(parseJsonRecord(liveConfigJson)),
      withoutRuntimeStamp(parseJsonRecord(desiredConfigJson)),
    );
  } catch {
    // An unreadable config cannot be proof that anything landed.
    return false;
  }
}

// Owner ids the live config actually holds; tolerant of a missing or hand-edited block.
export function readOwnerAllowFrom(configJson: string): string[] {
  const parsed = parseJsonRecord(configJson);
  const commands = isRecord(parsed.commands) ? parsed.commands : undefined;
  const raw = commands?.ownerAllowFrom;
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

function generateOpenclawConfig(
  config: InstanceConfig,
  gatewayToken: string,
): string {
  const provider = config.provider;
  validateProvider(provider);
  const model = buildModelSelection(provider);
  const models = buildModelsConfig(provider);
  const business = findWhatsappCloudChannel(config.channels);
  const tools = buildToolsConfig(provider, business ? buildToolsBySender(config) : null);
  const mcp = buildMcp(config);
  const media = new Set(provider.media ?? []);
  const owner = ownerPeerIds(ownerIdentityOf(config.channels));
  const name = config.displayName.trim();
  const openclawConfig: OpenclawConfig = {
    agents: {
      defaults: {
        model,
        ...(media.has("image") ? { imageModel: model } : {}),
        ...(media.has("pdf") ? { pdfModel: model } : {}),
        workspace: OPENCLAW_WORKSPACE_PATH,
        maxConcurrent: 2,
        heartbeat: HEARTBEAT,
      },
      entries: { [MAIN_AGENT_ID]: name ? { identity: { name } } : {} },
    },
    ...(models ? { models } : {}),
    channels: buildChannels(config.channels),
    ...(tools ? { tools } : {}),
    ...(mcp ? { mcp } : {}),
    plugins: buildPlugins(config.channels),
    gateway: {
      port: OPENCLAW_INTERNAL_PORT,
      mode: "local",
      bind: "lan",
      auth: { mode: "token", token: gatewayToken },
    },
    browser: {
      headless: true,
      noSandbox: true,
    },
    session: buildSession(owner),
    ...(owner.length > 0 ? { commands: { ownerAllowFrom: owner } } : {}),
  };

  return JSON.stringify(openclawConfig, null, 2);
}

function generateOpenclawEnv(
  config: InstanceConfig,
  gatewayToken: string,
): string {
  const lines: string[] = [];

  addEnvLine(lines, "OPENCLAW_GATEWAY_TOKEN", gatewayToken);
  addEnvLine(lines, providerEnvKey(config.provider), config.provider.apiKey);
  // The credit plugin gets its own names: the model client's key variable is derived from the
  // provider id, so sharing it would break the plugin silently the day that id changes.
  if (config.provider.name === "litellm" && config.provider.baseUrl) {
    addEnvLine(lines, "AGENTFORALL_CREDIT_BASE_URL", config.provider.baseUrl);
    addEnvLine(lines, "AGENTFORALL_CREDIT_API_KEY", config.provider.apiKey);
  }
  // The media plugin serves every gateway provider, not only LiteLLM budgets.
  if (isGatewayProvider(config.provider)) {
    addEnvLine(lines, "AGENTFORALL_MEDIA_BASE_URL", config.provider.baseUrl);
    addEnvLine(lines, MEDIA_ENV_KEY, config.provider.apiKey);
  }

  for (const ch of config.channels) {
    switch (ch.type) {
      case "telegram":
        if (ch.botToken) addEnvLine(lines, "TELEGRAM_BOT_TOKEN", ch.botToken);
        break;
      case "discord":
        addEnvLine(lines, "DISCORD_BOT_TOKEN", ch.token);
        break;
      case "slack":
        addEnvLine(lines, "SLACK_BOT_TOKEN", ch.botToken);
        addEnvLine(lines, "SLACK_APP_TOKEN", ch.appToken);
        break;
      case "whatsapp":
        break;
      case "whatsapp_cloud":
        addEnvLine(lines, WHATSAPP_CLOUD_RELAY_TOKEN_ENV, ch.relayToken);
        break;
    }
  }

  return lines.join("\n") + "\n";
}

// The credit plugin answers the user itself once the budget is spent, which is exactly when the
// model cannot. A plugin outside the OpenClaw bundle only receives before_agent_reply with
// allowConversationAccess, and the timeout keeps a slow budget lookup from holding up a reply.
// No `plugins.allow` here: OpenClaw reads it as the complete plugin set and drops bundled
// defaults such as memory-core (a live gateway went from 10 plugins to 3). The boot warning
// about an unpinned non-bundled plugin is the price.
function buildPlugins(channels: InstanceConfig["channels"]): OpenclawConfig["plugins"] {
  return {
    entries: {
      [CREDIT_PLUGIN_ID]: {
        enabled: true,
        hooks: { allowConversationAccess: true, timeoutMs: CREDIT_HOOK_TIMEOUT_MS },
      },
      [MEDIA_PLUGIN_ID]: { enabled: true },
      // Dreaming (nightly memory consolidation) is on by default; pinned so a default flip upstream
      // cannot change tenant spend unnoticed.
      [MEMORY_PLUGIN_ID]: { enabled: true, config: { dreaming: { enabled: true } } },
      ...(channels.some((ch) => ch.type === "whatsapp") ? { whatsapp: { enabled: true } } : {}),
      ...(channels.some((ch) => ch.type === "whatsapp_cloud")
        ? { [WHATSAPP_CLOUD_PLUGIN_ID]: { enabled: true } }
        : {}),
    },
  };
}

function buildChannels(channels: InstanceConfig["channels"]): ChannelsConfig {
  const block: ChannelsConfig = {};

  for (const ch of channels) {
    switch (ch.type) {
      case "telegram":
        if (!ch.botToken) break;
        block.telegram = {
          enabled: true,
          botToken: ch.botToken,
          dmPolicy: ch.dmPolicy ?? "pairing",
          ...(ch.allowFrom?.length ? { allowFrom: ch.allowFrom } : {}),
          // One error notice per incident instead of a reply to every message.
          errorPolicy: "once",
          // 2026.8 defaults to a tool-progress draft; the answer-text preview is what tenants know.
          streaming: { mode: "partial" },
          // Every group is blocked until listed, so without these the bot is silent in any group
          // the owner adds it to. The wildcard admits the group; "open" lets its other members
          // talk to the bot there, and the mention keeps it quiet until addressed.
          groupPolicy: "open",
          groups: { "*": { requireMention: true } },
        };
        break;
      case "discord":
        block.discord = {
          enabled: true,
          token: ch.token,
          groupPolicy: "allowlist",
          ...(ch.guildId
            ? {
                guilds: {
                  [ch.guildId]: {
                    requireMention: false,
                    channels: { "*": { allow: true } },
                  },
                },
              }
            : {}),
        };
        break;
      case "slack":
        block.slack = {
          enabled: true,
          botToken: ch.botToken,
          appToken: ch.appToken,
        };
        break;
      case "whatsapp":
        block.whatsapp = {
          enabled: true,
          ...whatsappDmPolicy(ch),
          defaultAccount: "default",
          // TODO: Revisit group allowlist/mention safety before exposing group use.
          accounts: {
            default: {
              enabled: true,
              authDir: OPENCLAW_WHATSAPP_SESSION_PATH,
            },
          },
          actions: {
            sendMessage: true,
            reactions: true,
          },
        };
        break;
      case "whatsapp_cloud":
        block.whatsapp_cloud = buildWhatsappCloudChannel(ch);
        break;
    }
  }

  return block;
}

// Customers are always open; the owner's identity is what separates them, not the allowlist.
function buildWhatsappCloudChannel(ch: WhatsappCloudChannelConfig): ChannelsConfig["whatsapp_cloud"] {
  return {
    enabled: true,
    dmPolicy: "open",
    allowFrom: ["*"],
    defaultAccount: "default",
    accounts: {
      default: {
        enabled: true,
        phoneNumberId: ch.phoneNumberId,
        displayPhoneNumber: ch.displayPhoneNumber,
        relayUrl: ch.relayUrl,
      },
    },
  };
}

// Undefined dmAccess = legacy open; "owner" without a number = claim mode (senders held for approval).
function whatsappDmPolicy(
  ch: WhatsappChannelConfig,
): Pick<WhatsAppChannelConfig, "dmPolicy" | "allowFrom"> {
  if (ch.dmAccess === "owner") {
    return ch.ownerNumber
      ? { dmPolicy: "allowlist", allowFrom: [ch.ownerNumber] }
      : { dmPolicy: "pairing" };
  }
  return { dmPolicy: "open", allowFrom: ["*"] };
}

// per-peer isolates strangers; identityLinks fold the owner's channels into one session.
// Always link (even one id) so the owner's session key is stable when a second channel joins.
function buildSession(owner: string[]): SessionConfig {
  return {
    dmScope: "per-peer",
    ...(owner.length > 0 ? { identityLinks: { owner } } : {}),
  };
}

function validateProvider(provider: ProviderConfig): void {
  if (provider.id && !provider.baseUrl) {
    throw new Error("provider id requires provider baseUrl");
  }
  if (provider.name === "litellm" && !provider.baseUrl) {
    throw new Error("LiteLLM provider requires DEFAULT_PROVIDER_BASE_URL");
  }
}

function buildModelSelection(provider: ProviderConfig) {
  return {
    primary: qualifyModel(provider, provider.model),
    ...(provider.fallbacks?.length
      ? { fallbacks: provider.fallbacks.map((model) => qualifyModel(provider, model)) }
      : {}),
  };
}

function buildModelsConfig(provider: ProviderConfig): OpenclawConfig["models"] {
  if (!provider.baseUrl) return undefined;
  const providerId = openclawProviderId(provider);
  return {
    mode: "merge",
    providers: {
      [providerId]: {
        api: "openai-completions",
        baseUrl: provider.baseUrl,
        apiKey: `\${${providerEnvKey(provider)}}`,
        models: [
          {
            id: provider.model,
            name: provider.model,
            reasoning: false,
            input: provider.input ?? ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
            // Without it OpenClaw 8.2+ records zero usage on a custom base URL, so auto-compaction never runs (#96463).
            compat: { supportsUsageInStreaming: true },
          },
        ],
        timeoutSeconds: 300,
      },
      // The media plugin's provider id needs an auth block of its own: OpenClaw resolves a custom
      // provider's key from models.providers.<id>.apiKey before it dispatches, and refuses with
      // ProviderAuthError otherwise. No models here — this entry is auth, not a model source.
      [MEDIA_PLUGIN_ID]: {
        api: "openai-completions",
        baseUrl: provider.baseUrl,
        apiKey: `\${${MEDIA_ENV_KEY}}`,
        models: [],
      },
    },
  };
}

// The container talks only to the orchestrator's relay; the provider key never reaches it.
function buildMcp(config: InstanceConfig): OpenclawConfig["mcp"] {
  if (!config.integrations) return undefined;
  return {
    servers: {
      [MCP_RELAY_SERVER_NAME]: {
        transport: "streamable-http",
        url: config.integrations.relayUrl,
        headers: { Authorization: `Bearer ${config.integrations.relayToken}` },
        requestTimeoutMs: 120_000,
        connectionTimeoutMs: 15_000,
      },
    },
  };
}

// Owner identities first (unrestricted), then the wildcard: OpenClaw stops at the first matching key.
function buildToolsBySender(config: InstanceConfig): Record<string, SenderToolPolicy> {
  const identity = ownerIdentityOf(config.channels);
  const policy: Record<string, SenderToolPolicy> = {};
  if (identity.telegramUserId) policy[`channel:telegram:${identity.telegramUserId}`] = {};
  if (identity.whatsappNumber) {
    policy[`e164:${identity.whatsappNumber}`] = {};
    // Our plugin reports the sender as +E.164 and never a separate e164 field, so the channel key is the one that matches.
    if (identity.hasBusinessNumber) policy[`channel:${WHATSAPP_CLOUD_CHANNEL_ID}:${identity.whatsappNumber}`] = {};
  }
  policy["*"] = STRANGER_TOOL_POLICY;
  return policy;
}

// One capability-tagged model list; each capability names its preferred entry.
function buildToolsConfig(
  provider: ProviderConfig,
  toolsBySender: Record<string, SenderToolPolicy> | null,
): OpenclawConfig["tools"] {
  const media = new Set(provider.media ?? []);
  const providerId = openclawProviderId(provider);
  const models: MediaModelEntry[] = [];
  const mediaConfig: MediaToolsConfig = { concurrency: 2, models };

  if (media.has("image")) {
    const entry = mediaModel(providerId, provider.model, "image");
    models.push(entry);
    mediaConfig.image = {
      enabled: true,
      preferredModel: mediaModelRef(entry),
      maxBytes: 20 * 1024 * 1024,
      timeoutSeconds: 180,
    };
  }
  if (media.has("audio")) {
    const entry = audioMediaModel(provider, providerId);
    models.push(entry);
    mediaConfig.audio = {
      enabled: true,
      preferredModel: mediaModelRef(entry),
      maxBytes: 20 * 1024 * 1024,
      timeoutSeconds: 90,
    };
  }
  // Video would need the same plugin treatment as audio; behind a gateway OpenClaw has no
  // video-capable provider to call, so the block is left out rather than promising a capability.
  if (media.has("video") && !isGatewayProvider(provider)) {
    const entry = mediaModel(providerId, provider.model, "video");
    models.push(entry);
    mediaConfig.video = {
      enabled: true,
      preferredModel: mediaModelRef(entry),
      maxBytes: 50 * 1024 * 1024,
      timeoutSeconds: 180,
    };
  }

  const tools: ToolsConfig = {
    ...(models.length > 0 ? { media: mediaConfig } : {}),
    // exec runs on the gateway host once there is no sandbox; a business bot never gets it.
    ...(toolsBySender ? { exec: { security: "deny" }, toolsBySender } : {}),
  };
  return Object.keys(tools).length > 0 ? tools : undefined;
}

// A direct provider (anthropic, openai, google…) is one OpenClaw transcribes with itself.
function audioMediaModel(provider: ProviderConfig, providerId: string): MediaModelEntry {
  if (!isGatewayProvider(provider)) return mediaModel(providerId, provider.model, "audio");
  return { ...mediaModel(MEDIA_PLUGIN_ID, provider.model, "audio"), baseUrl: provider.baseUrl };
}

function mediaModelRef(entry: MediaModelEntry): string {
  return `${entry.provider}/${entry.model}`;
}

// The same rule buildModelsConfig and providerEnvKey use: a baseUrl makes it a config provider,
// and OpenClaw registers those for image understanding alone.
function isGatewayProvider(provider: ProviderConfig): provider is ProviderConfig & { baseUrl: string } {
  return Boolean(provider.baseUrl);
}

function mediaModel(provider: string, model: string, capability: MediaCapability): MediaModelEntry {
  return { provider, model, capabilities: [capability] };
}

async function packTar(fill: (pack: tar.Pack) => Promise<void>): Promise<Buffer> {
  const pack = tar.pack();
  await fill(pack);
  pack.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of pack) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function writeEntry(
  pack: tar.Pack,
  header: tar.Headers,
  body?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    };
    if (body === undefined) pack.entry(header, done);
    else pack.entry(header, body, done);
  });
}

function addEnvLine(lines: string[], key: string, value: string): void {
  if (/[\n\r\0]/.test(value)) {
    throw new Error(`value for ${key} contains invalid characters`);
  }
  lines.push(`${key}=${value}`);
}

function providerEnvKey(provider: ProviderConfig): string {
  if (!provider.baseUrl) return PROVIDER_ENV_KEY[provider.name];
  return `${openclawProviderId(provider).replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

function qualifyModel(provider: ProviderConfig, model: string): string {
  return model.includes("/")
    ? model
    : `${openclawProviderId(provider)}/${model}`;
}

function openclawProviderId(provider: ProviderConfig): string {
  return provider.id ?? OPENCLAW_PROVIDER_PREFIX[provider.name];
}

function parseJsonRecord(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) throw new Error("openclaw config must be an object");
  return parsed;
}

// Everything the orchestrator renders, addressed by path. The gateway keys are here because they
// are the control plane rather than a preference: losing them would lock us out of the container.
const OWNED_PATHS: readonly (readonly string[])[] = [
  ["agents", "defaults", "model"],
  ["agents", "defaults", "imageModel"],
  ["agents", "defaults", "pdfModel"],
  ["agents", "defaults", "heartbeat"],
  // Only the name: the rest of the entry, and any other agent, is the tenant's.
  ["agents", "entries", MAIN_AGENT_ID, "identity", "name"],
  ["models"],
  ["tools"],
  ["gateway", "port"],
  ["gateway", "mode"],
  ["gateway", "bind"],
  ["gateway", "auth"],
  ["session"],
  ["commands", "ownerAllowFrom"],
  ["plugins", "entries", "whatsapp"],
  ["plugins", "entries", CREDIT_PLUGIN_ID],
  ["plugins", "entries", MEDIA_PLUGIN_ID],
  ["plugins", "entries", MEMORY_PLUGIN_ID],
  ["plugins", "entries", WHATSAPP_CLOUD_PLUGIN_ID],
  ["mcp", "servers", MCP_RELAY_SERVER_NAME],
];

// Per channel, the keys the dashboard sets. Anything else under a channel — the per-group entries
// the runtime writes, the WhatsApp device state — belongs to the container.
const CHANNEL_OWNED_PATHS: Record<ChannelType, readonly (readonly string[])[]> = {
  telegram: [["enabled"], ["botToken"], ["dmPolicy"], ["allowFrom"], ["errorPolicy"], ["streaming", "mode"]],
  discord: [["enabled"], ["token"], ["groupPolicy"], ["guilds"]],
  slack: [["enabled"], ["botToken"], ["appToken"]],
  whatsapp: [
    ["enabled"],
    ["dmPolicy"],
    ["allowFrom"],
    ["defaultAccount"],
    ["actions"],
    ["accounts", "default", "enabled"],
    ["accounts", "default", "authDir"],
  ],
  // Ours end to end: the plugin writes nothing back into its block.
  whatsapp_cloud: [["enabled"], ["dmPolicy"], ["allowFrom"], ["defaultAccount"], ["accounts"]],
};

// Defaults delivered only while the tenant has said nothing about them. No dashboard control
// renders Telegram's group access, so an owner who turned groups off from the chat keeps that;
// a block that simply predates the default — every bot linked before it existed — still gets it.
const CHANNEL_DEFAULT_PATHS: Partial<Record<ChannelType, readonly (readonly string[])[]>> = {
  telegram: [["groupPolicy"], ["groups"]],
};

function ownedPaths(
  generated: Record<string, unknown>,
  live: Record<string, unknown>,
): (readonly string[])[] {
  const channels = isRecord(generated.channels) ? generated.channels : {};
  const liveChannels = isRecord(live.channels) ? live.channels : {};
  return [
    ...OWNED_PATHS,
    ...CHANNEL_TYPES.flatMap((type) => {
      // A channel the dashboard no longer renders is removed whole, which is what disconnecting it
      // means; while it exists, only its own keys are ours.
      if (!isRecord(channels[type])) return [["channels", type]];
      const liveEntry = liveChannels[type];
      const liveBlock = isRecord(liveEntry) ? liveEntry : {};
      const paths = [
        ...CHANNEL_OWNED_PATHS[type],
        ...(CHANNEL_DEFAULT_PATHS[type] ?? []).filter(
          (path) => readPath(liveBlock, path) === undefined,
        ),
      ];
      return paths.map((path) => ["channels", type, ...path]);
    }),
  ];
}

function readPath(source: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

// An undefined value means the orchestrator does not render that field, so it is removed rather
// than left behind: that is how clearing a setting in the dashboard actually takes effect.
function setPath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  const [key, ...rest] = path;
  if (key === undefined) return;
  if (rest.length === 0) {
    if (value === undefined) delete target[key];
    else target[key] = value;
    return;
  }
  if (!isRecord(target[key])) {
    if (value === undefined) return;
    target[key] = {};
  }
  const child = target[key] as Record<string, unknown>;
  setPath(child, rest, value);
  // A block we emptied was only ever holding our field, so it goes with it; one the tenant also
  // writes to still has their keys and stays.
  if (value === undefined && Object.keys(child).length === 0) delete target[key];
}

function withoutRuntimeStamp(config: Record<string, unknown>): Record<string, unknown> {
  const { meta: _meta, ...rest } = config;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { isDeepStrictEqual } from "node:util";
import tar from "tar-stream";
import { CHANNEL_TYPES } from "../../../domain/types.js";
import type {
  ChannelType,
  InstanceConfig,
  LlmProvider,
  ProviderConfig,
  ProviderMediaCapability,
  WhatsappChannelConfig,
} from "../../../domain/types.js";
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
  OpenclawConfig,
  SessionConfig,
  WhatsAppChannelConfig,
} from "./schema.js";

const PROVIDER_ENV_KEY: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  litellm: "LITELLM_API_KEY",
};

const CREDIT_HOOK_TIMEOUT_MS = 3000;

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
      mode: 0o755,
      ...OPENCLAW_USER,
    });
    await writeEntry(pack, { name: ".openclaw/.env", mode: 0o600, ...OPENCLAW_USER }, dotEnv);
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
      mode: 0o755,
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
  const tools = buildToolsConfig(provider);
  const media = new Set(provider.media ?? []);
  const owner = ownerPeerIds(ownerIdentityOf(config.channels));
  const openclawConfig: OpenclawConfig = {
    agents: {
      defaults: {
        model,
        ...(media.has("image") ? { imageModel: model } : {}),
        ...(media.has("pdf") ? { pdfModel: model } : {}),
        workspace: OPENCLAW_WORKSPACE_PATH,
        maxConcurrent: 2,
      },
      list: [{ id: "main", default: true }],
    },
    ...(models ? { models } : {}),
    channels: buildChannels(config.channels),
    ...(tools ? { tools } : {}),
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
    logging: { redactSensitive: "tools" },
    session: buildSession(owner),
    ...(owner.length > 0 ? { commands: { ownerAllowFrom: owner } } : {}),
    web: {
      whatsapp: {
        keepAliveIntervalMs: 15000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      },
      // Default cap is 30s, so a WhatsApp 405 throttle turns into ~120 handshakes/hour
      // and keeps the block alive. Back off to 10min so throttles can expire.
      reconnect: {
        initialMs: 5000,
        maxMs: 600000,
        factor: 2,
        jitter: 0.3,
        maxAttempts: 12,
      },
    },
  };

  return JSON.stringify(openclawConfig, null, 2);
}

function generateOpenclawEnv(
  config: InstanceConfig,
  gatewayToken: string,
): string {
  const lines: string[] = [];

  addEnvLine(lines, "OPENCLAW_GATEWAY_TOKEN", gatewayToken);
  lines.push("OPENCLAW_HEADLESS=true");
  addEnvLine(lines, providerEnvKey(config.provider), config.provider.apiKey);
  // The credit plugin gets its own names: the model client's key variable is derived from the
  // provider id, so sharing it would break the plugin silently the day that id changes.
  if (config.provider.name === "litellm" && config.provider.baseUrl) {
    addEnvLine(lines, "AGENTFORALL_CREDIT_BASE_URL", config.provider.baseUrl);
    addEnvLine(lines, "AGENTFORALL_CREDIT_API_KEY", config.provider.apiKey);
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
        lines.push("WHATSAPP_ENABLED=true");
        lines.push(`WHATSAPP_SESSION_PATH=${OPENCLAW_WHATSAPP_SESSION_PATH}`);
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
      "agentforall-credit": {
        enabled: true,
        hooks: { allowConversationAccess: true, timeoutMs: CREDIT_HOOK_TIMEOUT_MS },
      },
      ...(channels.some((ch) => ch.type === "whatsapp") ? { whatsapp: { enabled: true } } : {}),
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
    }
  }

  return block;
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
          },
        ],
        timeoutSeconds: 300,
      },
    },
  };
}

function buildToolsConfig(provider: ProviderConfig): OpenclawConfig["tools"] {
  const media = new Set(provider.media ?? []);
  const providerId = openclawProviderId(provider);
  const mediaConfig: NonNullable<OpenclawConfig["tools"]>["media"] = {
    concurrency: 2,
  };

  if (media.has("image")) {
    mediaConfig.image = {
      enabled: true,
      maxBytes: 20 * 1024 * 1024,
      timeoutSeconds: 180,
      models: [mediaModel(providerId, provider.model, "image")],
    };
  }
  if (media.has("audio")) {
    mediaConfig.audio = {
      enabled: true,
      maxBytes: 20 * 1024 * 1024,
      timeoutSeconds: 90,
      models: [mediaModel(providerId, provider.model, "audio")],
    };
  }
  if (media.has("video")) {
    mediaConfig.video = {
      enabled: true,
      maxBytes: 50 * 1024 * 1024,
      timeoutSeconds: 180,
      models: [mediaModel(providerId, provider.model, "video")],
    };
  }

  return mediaConfig.image || mediaConfig.audio || mediaConfig.video
    ? { media: mediaConfig }
    : undefined;
}

function mediaModel(
  provider: string,
  model: string,
  capability: Exclude<ProviderMediaCapability, "pdf">,
) {
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

// Everything the orchestrator renders, addressed by path. `gateway` is here because it is the
// control plane rather than a preference: losing it would lock us out of the container.
const OWNED_PATHS: readonly (readonly string[])[] = [
  ["agents", "defaults", "model"],
  ["agents", "defaults", "imageModel"],
  ["agents", "defaults", "pdfModel"],
  ["models"],
  ["tools"],
  ["gateway"],
  ["session"],
  ["commands", "ownerAllowFrom"],
  ["plugins", "entries", "whatsapp"],
  ["plugins", "entries", "agentforall-credit"],
];

// Per channel, the keys the dashboard sets. Anything else under a channel — the per-group entries
// the runtime writes, the WhatsApp device state — belongs to the container.
const CHANNEL_OWNED_PATHS: Record<ChannelType, readonly (readonly string[])[]> = {
  telegram: [["enabled"], ["botToken"], ["dmPolicy"], ["allowFrom"], ["errorPolicy"]],
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

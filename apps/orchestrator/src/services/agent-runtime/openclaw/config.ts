import tar from "tar-stream";
import type {
  InstanceConfig,
  LlmProvider,
  ProviderConfig,
  ProviderMediaCapability,
  WhatsappChannelConfig,
} from "../../../domain/types.js";
import { ownerIdentityOf, ownerPeerIds } from "../../../domain/owner.js";
import type { RuntimeConfigFiles } from "../types.js";
import {
  OPENCLAW_CONFIG_PATH,
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

export function generateRuntimePatchedOpenclawFiles(
  existingConfigJson: string,
  config: InstanceConfig,
  gatewayToken: string,
): RuntimeConfigFiles {
  const existing = parseJsonRecord(existingConfigJson);
  const generated = parseJsonRecord(generateOpenclawConfig(config, gatewayToken));
  const merged = {
    ...generated,
    ...existing,
  };
  const patched = {
    ...merged,
    agents: generated.agents,
    models: generated.models,
    tools: generated.tools,
    gateway: generated.gateway,
    channels: mergeChannels(generated.channels, existing.channels),
    session: generated.session,
    commands: generated.commands,
    plugins: mergeRecords(generated.plugins, existing.plugins),
    web: mergeRecords(generated.web, existing.web),
    browser: merged.browser,
    logging: merged.logging,
  };
  return {
    configJson: JSON.stringify(patched, null, 2),
    dotEnv: generateOpenclawEnv(config, gatewayToken),
  };
}

export async function buildOpenclawConfigTar(
  files: RuntimeConfigFiles,
): Promise<Buffer> {
  const pack = tar.pack();
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

  pack.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of pack) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function openclawReadConfigCommand(): string[] {
  return ["cat", OPENCLAW_CONFIG_PATH];
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
    ...(config.channels.some((ch) => ch.type === "whatsapp")
      ? { plugins: { entries: { whatsapp: { enabled: true } } } }
      : {}),
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

function mergeRecords(
  generated: unknown,
  existing: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(generated) && !isRecord(existing)) return undefined;
  return {
    ...(isRecord(generated) ? generated : {}),
    ...(isRecord(existing) ? existing : {}),
  };
}

function mergeChannels(generated: unknown, existing: unknown): unknown {
  const merged = mergeRecords(generated, existing);
  if (!merged) return generated ?? existing;
  if (isRecord(generated) && isRecord(existing)) {
    // Runtime-written WhatsApp keys survive, but presence + access policy are orchestrator-owned.
    if (isRecord(generated.whatsapp)) {
      merged.whatsapp = mergeRecords(existing.whatsapp, generated.whatsapp);
      if (isRecord(merged.whatsapp) && !("allowFrom" in generated.whatsapp)) {
        delete merged.whatsapp.allowFrom;
      }
    } else {
      delete merged.whatsapp;
    }
    // Telegram is orchestrator-owned; replace (not merge) so stale keys can't survive.
    merged.telegram = generated.telegram;
    if (merged.telegram === undefined) delete merged.telegram;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

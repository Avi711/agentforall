import tar from "tar-stream";
import type {
  InstanceConfig,
  LlmProvider,
  ProviderConfig,
} from "../../../domain/types.js";
import type { RuntimeConfigFiles } from "../types.js";
import {
  HERMES_CONFIG_PATH,
  HERMES_INTERNAL_PORT,
  HERMES_STATE_DIR,
  HERMES_USER,
  HERMES_WHATSAPP_SESSION_DIR,
  HERMES_WORKSPACE_PATH,
} from "./constants.js";
import type { HermesConfig } from "./schema.js";

const PROVIDER_ENV_KEY: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GOOGLE_API_KEY",
  litellm: "LITELLM_API_KEY",
};

const HERMES_PROVIDER: Record<LlmProvider, string> = {
  anthropic: "anthropic",
  openai: "openai-api",
  openrouter: "openrouter",
  gemini: "gemini",
  litellm: "custom:litellm",
};

export function generateHermesFiles(
  config: InstanceConfig,
  gatewayToken: string,
): RuntimeConfigFiles {
  return {
    configJson: generateHermesConfig(config),
    dotEnv: generateHermesEnv(config, gatewayToken),
  };
}

export async function buildHermesConfigTar(
  files: RuntimeConfigFiles,
): Promise<Buffer> {
  const pack = tar.pack();
  const owner = HERMES_USER;

  await writeEntry(pack, {
    name: `${HERMES_STATE_DIR}/`,
    type: "directory",
    mode: 0o755,
    ...owner,
  });
  await writeEntry(pack, {
    name: `${HERMES_STATE_DIR}/workspace/`,
    type: "directory",
    mode: 0o755,
    ...owner,
  });
  await writeEntry(pack, {
    name: `${HERMES_STATE_DIR}/platforms/`,
    type: "directory",
    mode: 0o755,
    ...owner,
  });
  await writeEntry(pack, {
    name: `${HERMES_STATE_DIR}/platforms/whatsapp/`,
    type: "directory",
    mode: 0o755,
    ...owner,
  });
  await writeEntry(pack, {
    name: `${HERMES_STATE_DIR}/platforms/whatsapp/${HERMES_WHATSAPP_SESSION_DIR}/`,
    type: "directory",
    mode: 0o700,
    ...owner,
  });
  await writeEntry(
    pack,
    { name: `${HERMES_STATE_DIR}/config.yaml`, mode: 0o644, ...owner },
    files.configJson,
  );
  await writeEntry(
    pack,
    { name: `${HERMES_STATE_DIR}/.env`, mode: 0o600, ...owner },
    files.dotEnv,
  );

  pack.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of pack) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function hermesReadConfigCommand(): string[] {
  return ["cat", HERMES_CONFIG_PATH];
}

function generateHermesConfig(config: InstanceConfig): string {
  const provider = config.provider;
  validateProvider(provider);
  const hermesConfig: HermesConfig = {
    ...buildProviderConfig(provider),
    terminal: {
      backend: "local",
      cwd: HERMES_WORKSPACE_PATH,
    },
    security: {
      redact_secrets: true,
    },
    approvals: {
      mode: "off",
    },
    agent: {
      gateway_notify_interval: 0,
    },
    display: {
      busy_input_mode: "queue",
      busy_ack_enabled: false,
      interim_assistant_messages: false,
      platforms: {
        whatsapp: {
          tool_progress: "off",
          runtime_footer: {
            enabled: false,
          },
        },
      },
    },
    platforms: {
      api_server: {
        enabled: true,
        extra: {
          host: "0.0.0.0",
          port: HERMES_INTERNAL_PORT,
          model_name: "hermes-agent",
        },
      },
      ...(config.channels.some((ch) => ch.type === "whatsapp")
        ? {
            whatsapp: {
              enabled: true,
            },
          }
        : {}),
    },
    unauthorized_dm_behavior: "pair",
    ...(config.channels.some((ch) => ch.type === "whatsapp")
      ? {
          whatsapp: {
            unauthorized_dm_behavior: "ignore",
            reply_prefix: "",
          },
        }
      : {}),
  };

  return JSON.stringify(hermesConfig, null, 2);
}

function generateHermesEnv(
  config: InstanceConfig,
  gatewayToken: string,
): string {
  const lines: string[] = [];

  lines.push("API_SERVER_ENABLED=true");
  lines.push(`API_SERVER_PORT=${HERMES_INTERNAL_PORT}`);
  lines.push("API_SERVER_HOST=0.0.0.0");
  addEnvLine(lines, "API_SERVER_KEY", gatewayToken);
  lines.push("API_SERVER_MODEL_NAME=hermes-agent");
  lines.push("HERMES_HOME=/opt/data");
  lines.push("HERMES_GATEWAY_BUSY_ACK_ENABLED=false");
  addProviderEnvLines(lines, config.provider);

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
        lines.push("WHATSAPP_MODE=bot");
        lines.push("WHATSAPP_ALLOWED_USERS=*");
        break;
    }
  }

  return lines.join("\n") + "\n";
}

function buildProviderConfig(
  provider: ProviderConfig,
): Pick<HermesConfig, "model" | "custom_providers"> {
  if (!provider.baseUrl) {
    return {
      model: {
        default: provider.model,
        provider: HERMES_PROVIDER[provider.name],
        ...(supportsNativeVision(provider) ? { supports_vision: true } : {}),
      },
    };
  }

  const providerName = hermesCustomProviderName(provider);
  return {
    custom_providers: [
      {
        name: providerName,
        base_url: provider.baseUrl,
        key_env: providerEnvKey(provider),
        api_mode: "chat_completions",
        models: {
          [provider.model]: {
            context_length: 200000,
            max_tokens: 8192,
          },
        },
      },
    ],
    model: {
      default: provider.model,
      provider: `custom:${providerName}`,
      ...(supportsNativeVision(provider) ? { supports_vision: true } : {}),
    },
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

function addProviderEnvLines(lines: string[], provider: ProviderConfig): void {
  if (provider.name === "gemini" && !provider.baseUrl) {
    addEnvLine(lines, "GOOGLE_API_KEY", provider.apiKey);
    addEnvLine(lines, "GEMINI_API_KEY", provider.apiKey);
    return;
  }
  addEnvLine(lines, providerEnvKey(provider), provider.apiKey);
}

function providerEnvKey(provider: ProviderConfig): string {
  if (!provider.baseUrl) return PROVIDER_ENV_KEY[provider.name];
  return `${hermesCustomProviderName(provider).replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

function hermesCustomProviderName(provider: ProviderConfig): string {
  return provider.id ?? provider.name;
}

function supportsNativeVision(provider: ProviderConfig): boolean {
  return provider.input?.includes("image") || provider.media?.includes("image") || false;
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

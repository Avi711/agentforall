import type {
  InstanceConfig,
  ChannelConfig,
  LlmProvider,
} from "../domain/types.js";

const PROVIDER_ENV_KEY: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export class ConfigGenerator {
  generateOpenclawConfig(
    config: InstanceConfig,
    gatewayToken: string,
  ): string {
    const openclawConfig = {
      agents: {
        defaults: {
          model: {
            primary: config.provider.model,
            ...(config.provider.fallbacks?.length
              ? { fallbacks: config.provider.fallbacks }
              : {}),
          },
          workspace: "/home/node/.openclaw/workspace",
          maxConcurrent: 2,
        },
        list: [{ id: "main", default: true }],
      },
      channels: this.buildChannels(config.channels),
      gateway: {
        port: 18789,
        mode: "local",
        bind: "lan",
        auth: {
          mode: "token",
          token: gatewayToken,
        },
      },
      logging: {
        redactSensitive: "tools",
      },
    };

    return JSON.stringify(openclawConfig, null, 2);
  }

  generateEnvFile(config: InstanceConfig, gatewayToken: string): string {
    const lines: string[] = [];

    this.addEnvLine(lines, "OPENCLAW_GATEWAY_TOKEN", gatewayToken);
    lines.push("OPENCLAW_HEADLESS=true");
    this.addEnvLine(
      lines,
      PROVIDER_ENV_KEY[config.provider.name],
      config.provider.apiKey,
    );

    for (const ch of config.channels) {
      switch (ch.type) {
        case "telegram":
          this.addEnvLine(lines, "TELEGRAM_BOT_TOKEN", ch.botToken);
          break;
        case "discord":
          this.addEnvLine(lines, "DISCORD_BOT_TOKEN", ch.token);
          break;
        case "slack":
          this.addEnvLine(lines, "SLACK_BOT_TOKEN", ch.botToken);
          this.addEnvLine(lines, "SLACK_APP_TOKEN", ch.appToken);
          break;
        case "whatsapp":
          break;
      }
    }

    return lines.join("\n") + "\n";
  }

  private addEnvLine(lines: string[], key: string, value: string): void {
    if (/[\n\r\0]/.test(value)) {
      throw new Error(
        `value for ${key} contains invalid characters (newline or null)`,
      );
    }
    lines.push(`${key}=${value}`);
  }

  private buildChannels(
    channels: ChannelConfig[],
  ): Record<string, unknown> {
    const block: Record<string, unknown> = {};

    for (const ch of channels) {
      switch (ch.type) {
        case "telegram":
          block.telegram = {
            enabled: true,
            botToken: ch.botToken,
            dmPolicy: ch.dmPolicy ?? "pairing",
            streamMode: "partial",
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
          block.whatsapp = { enabled: true };
          break;
      }
    }

    return block;
  }
}

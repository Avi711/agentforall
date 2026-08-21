export interface HermesConfig {
  model: HermesModelConfig;
  custom_providers?: HermesCustomProviderConfig[];
  terminal: {
    backend: "local";
    cwd: string;
  };
  security: {
    redact_secrets: boolean;
  };
  approvals: {
    mode: "off";
  };
  agent: {
    gateway_notify_interval: 0;
  };
  display: {
    busy_input_mode: "queue";
    busy_ack_enabled: false;
    interim_assistant_messages: false;
    platforms: {
      whatsapp: {
        tool_progress: "off";
        runtime_footer: {
          enabled: false;
        };
      };
    };
  };
  platforms: {
    api_server: {
      enabled: true;
      extra: {
        host: "0.0.0.0";
        port: number;
        model_name: "hermes-agent";
      };
    };
    whatsapp?: {
      enabled: true;
    };
  };
  unauthorized_dm_behavior: "pair" | "ignore";
  whatsapp?: {
    unauthorized_dm_behavior: "ignore";
    reply_prefix: string;
  };
}

export interface HermesModelConfig {
  default: string;
  provider: string;
  supports_vision?: boolean;
  base_url?: string;
  api_key?: string;
  api_mode?: "chat_completions";
}

export interface HermesCustomProviderConfig {
  name: string;
  base_url: string;
  key_env: string;
  api_mode: "chat_completions";
  models?: Record<string, HermesCustomProviderModelConfig>;
}

export interface HermesCustomProviderModelConfig {
  context_length?: number;
  max_tokens?: number;
}

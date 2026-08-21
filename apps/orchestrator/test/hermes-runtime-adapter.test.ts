import { test } from "node:test";
import assert from "node:assert/strict";
import tar from "tar-stream";
import { HermesRuntimeAdapter } from "../src/services/agent-runtime/hermes/adapter.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { Instance, InstanceConfig } from "../src/domain/types.js";

test("generated Hermes config uses LiteLLM as a named custom provider", () => {
  const adapter = new HermesRuntimeAdapter({} as ContainerRuntime, "hermes-image");
  const files = adapter.generateConfig(liteLlmConfig, "gateway-token");
  const config = JSON.parse(files.configJson) as {
    model: { provider: string; default: string; supports_vision?: boolean };
    custom_providers?: {
      name: string;
      base_url: string;
      key_env: string;
      api_mode: string;
      models?: Record<string, { context_length?: number; max_tokens?: number }>;
    }[];
    terminal: { backend: string; cwd: string };
    security: { redact_secrets: boolean };
    approvals: { mode: string };
    agent: { gateway_notify_interval: number };
    display: {
      busy_input_mode: string;
      busy_ack_enabled: boolean;
      interim_assistant_messages: boolean;
      platforms: {
        whatsapp?: {
          tool_progress: string;
          runtime_footer: { enabled: boolean };
        };
      };
    };
    platforms: {
      api_server: {
        enabled: boolean;
        extra: { host: string; port: number; model_name: string };
      };
      whatsapp?: { enabled: boolean };
    };
    whatsapp?: { unauthorized_dm_behavior: string; reply_prefix: string };
  };

  assert.equal(config.model.provider, "custom:litellm");
  assert.equal(config.model.default, "gemini-agentforall");
  assert.equal(config.model.supports_vision, true);
  assert.equal(config.custom_providers?.[0]?.name, "litellm");
  assert.equal(
    config.custom_providers?.[0]?.base_url,
    "https://litellm-gateway.example/v1",
  );
  assert.equal(config.custom_providers?.[0]?.key_env, "LITELLM_API_KEY");
  assert.equal(config.custom_providers?.[0]?.api_mode, "chat_completions");
  assert.deepEqual(config.custom_providers?.[0]?.models?.["gemini-agentforall"], {
    context_length: 200000,
    max_tokens: 8192,
  });
  assert.deepEqual(config.terminal, {
    backend: "local",
    cwd: "/opt/data/workspace",
  });
  assert.equal(config.security.redact_secrets, true);
  assert.deepEqual(config.approvals, { mode: "off" });
  assert.deepEqual(config.agent, { gateway_notify_interval: 0 });
  assert.deepEqual(config.display, {
    busy_input_mode: "queue",
    busy_ack_enabled: false,
    interim_assistant_messages: false,
    platforms: {
      whatsapp: {
        tool_progress: "off",
        runtime_footer: { enabled: false },
      },
    },
  });
  assert.deepEqual(config.platforms.api_server, {
    enabled: true,
    extra: {
      host: "0.0.0.0",
      port: 8642,
      model_name: "hermes-agent",
    },
  });
  assert.deepEqual(config.platforms.whatsapp, { enabled: true });
  assert.deepEqual(config.whatsapp, {
    unauthorized_dm_behavior: "ignore",
    reply_prefix: "",
  });
  assert.match(files.dotEnv, /^API_SERVER_ENABLED=true$/m);
  assert.match(files.dotEnv, /^API_SERVER_HOST=0\.0\.0\.0$/m);
  assert.match(files.dotEnv, /^API_SERVER_PORT=8642$/m);
  assert.match(files.dotEnv, /^API_SERVER_KEY=gateway-token$/m);
  assert.match(files.dotEnv, /^HERMES_GATEWAY_BUSY_ACK_ENABLED=false$/m);
  assert.match(files.dotEnv, /^LITELLM_API_KEY=litellm-key$/m);
  assert.match(files.dotEnv, /^WHATSAPP_ENABLED=true$/m);
  assert.match(files.dotEnv, /^WHATSAPP_ALLOWED_USERS=\*$/m);
});

test("Hermes container options keep the official entrypoint and run gateway mode", async () => {
  const adapter = new HermesRuntimeAdapter({} as ContainerRuntime, "hermes-image");
  const options = await adapter.buildContainerOptions(instance);

  assert.deepEqual(options.command, ["gateway", "run"]);
  assert.equal(options.capDrop, null);
  assert.deepEqual(options.capAdd, []);
  assert.equal(options.securityOpt, null);
  assert.equal(options.internalPort, 8642);
  assert.equal(options.healthPath, "/health");
  assert.deepEqual(options.volumeMounts?.[0], {
    name: "hm-4b86fc8b-ef1-state",
    containerPath: "/opt/data",
  });
  assert.ok(options.envVars.includes("HERMES_UID=10000"));
  assert.ok(options.envVars.includes("HERMES_GID=10000"));
  assert.ok(options.envVars.includes("API_SERVER_ENABLED=true"));
  assert.ok(options.envVars.includes("API_SERVER_KEY=token"));
  assert.ok(options.envVars.includes("HERMES_GATEWAY_BUSY_ACK_ENABLED=false"));
  assert.ok(options.envVars.includes("LITELLM_API_KEY=litellm-key"));
  assert.ok(options.envVars.includes("WHATSAPP_ENABLED=true"));
  assert.equal(options.initialArchive?.targetPath, "/opt");
  const archive = options.initialArchive?.content;
  assert.ok(Buffer.isBuffer(archive));

  const config = await readTarEntry(
    archive,
    "data/config.yaml",
  );
  const env = await readTarEntry(archive, "data/.env");
  assert.match(config, /"provider": "custom:litellm"/);
  assert.match(env, /^API_SERVER_KEY=token$/m);
});

const liteLlmConfig: InstanceConfig = {
  displayName: "LiteLLM",
  provider: {
    name: "litellm",
    apiKey: "litellm-key",
    model: "gemini-agentforall",
    baseUrl: "https://litellm-gateway.example/v1",
    input: ["text", "image"],
    media: ["image", "audio", "video", "pdf"],
  },
  channels: [{ type: "whatsapp" }],
  resources: { memoryMb: 4096, cpuShares: 512 },
};

const instance: Instance = {
  id: "4b86fc8b-ef19-496b-9591-583c72069443",
  userId: "user_1",
  hostId: "local-dev",
  runtimeKind: "hermes",
  displayName: "LiteLLM",
  status: "running",
  config: liteLlmConfig,
  containerId: "container-1",
  containerName: "hermes-4b86fc8b-ef1",
  gatewayPort: 19000,
  gatewayToken: "token",
  healthFailures: 0,
  errorMessage: null,
  pairingStatus: "none",
  whatsappAccountId: null,
  hasWhatsappCreds: false,
  lastSeenAt: null,
  backupImport: {
    status: "none",
    objectName: null,
    contentLength: null,
    contentType: null,
  },
  litellm: {
    keyAlias: "agentforall-test",
    keyHash: "hash",
    budgetCents: 5000,
    budgetDuration: "30d",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  stoppedAt: null,
  destroyedAt: null,
};

function readTarEntry(archive: Buffer, name: string): Promise<string> {
  const extract = tar.extract();
  return new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        if (header.name === name) {
          resolve(Buffer.concat(chunks).toString("utf8"));
          return;
        }
        next();
      });
      stream.resume();
    });
    extract.on("finish", () => reject(new Error(`missing tar entry ${name}`)));
    extract.on("error", reject);
    extract.end(archive);
  });
}

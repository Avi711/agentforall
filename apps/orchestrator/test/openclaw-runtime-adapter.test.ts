import { test } from "node:test";
import assert from "node:assert/strict";
import tar from "tar-stream";
import { OpenClawRuntimeAdapter } from "../src/services/agent-runtime/openclaw/adapter.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { Instance, InstanceConfig } from "../src/domain/types.js";

test("generated config supports LiteLLM media provider", () => {
  const adapter = new OpenClawRuntimeAdapter({} as ContainerRuntime, "openclaw-image");
  const files = adapter.generateConfig(liteLlmConfig, "gateway-token");
  const config = JSON.parse(files.configJson) as {
    agents: {
      defaults: {
        model: { primary: string };
        imageModel?: { primary: string };
        pdfModel?: { primary: string };
      };
    };
    models?: {
      providers: Record<
        string,
        {
          api: string;
          baseUrl: string;
          apiKey: string;
          models: { id: string; input?: string[] }[];
        }
      >;
    };
    tools?: {
      media?: {
        image?: { models: { provider: string; model: string; capabilities?: string[] }[] };
        audio?: { models: { provider: string; model: string; capabilities?: string[] }[] };
        video?: { models: { provider: string; model: string; capabilities?: string[] }[] };
        pdf?: unknown;
      };
    };
    web?: {
      whatsapp?: {
        keepAliveIntervalMs: number;
        connectTimeoutMs: number;
        defaultQueryTimeoutMs: number;
      };
    };
  };

  assert.equal(config.agents.defaults.model.primary, "litellm/gemini-agentforall");
  assert.equal(config.agents.defaults.imageModel?.primary, "litellm/gemini-agentforall");
  assert.equal(config.agents.defaults.pdfModel?.primary, "litellm/gemini-agentforall");
  assert.equal(config.models?.providers.litellm.api, "openai-completions");
  assert.equal(
    config.models?.providers.litellm.baseUrl,
    "https://litellm-gateway.example/v1",
  );
  assert.equal(config.models?.providers.litellm.apiKey, "${LITELLM_API_KEY}");
  assert.deepEqual(config.models?.providers.litellm.models[0], {
    id: "gemini-agentforall",
    name: "gemini-agentforall",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  });
  assert.deepEqual(config.tools?.media?.image?.models[0], {
    provider: "litellm",
    model: "gemini-agentforall",
    capabilities: ["image"],
  });
  assert.deepEqual(config.tools?.media?.audio?.models[0], {
    provider: "litellm",
    model: "gemini-agentforall",
    capabilities: ["audio"],
  });
  assert.deepEqual(config.tools?.media?.video?.models[0], {
    provider: "litellm",
    model: "gemini-agentforall",
    capabilities: ["video"],
  });
  assert.equal(config.tools?.media?.pdf, undefined);
  assert.deepEqual(config.web?.whatsapp, {
    keepAliveIntervalMs: 15000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
  });
  assert.match(files.dotEnv, /^LITELLM_API_KEY=litellm-key$/m);
});

test("runtime patch replaces imported provider config with platform LiteLLM config", async () => {
  let configArchive: Buffer | null = null;
  const runtime = {
    isRunning: async () => true,
    execCommandBuffer: async () => ({
      exitCode: 0,
      stdout: Buffer.from(JSON.stringify(existingConfig)),
      stderr: "",
    }),
    putArchive: async (
      _containerId: string,
      _targetPath: string,
      archive: Buffer,
    ) => {
      configArchive = archive;
    },
  } as unknown as ContainerRuntime;

  const adapter = new OpenClawRuntimeAdapter(runtime, "openclaw-image");
  await adapter.refreshConfig("container-1", instance);

  assert.ok(configArchive);
  const patched = JSON.parse(
    await readTarEntry(configArchive, ".openclaw/openclaw.json"),
  ) as typeof existingConfig;

  assert.equal(patched.agents.defaults.model.primary, "litellm/gemini-agentforall");
  assert.equal(
    patched.models.providers.litellm.baseUrl,
    "https://litellm-gateway.example/v1",
  );
  assert.equal(patched.models.providers.google35, undefined);
  assert.deepEqual(patched.session, { dmScope: "per-peer" });
  assert.equal(patched.gateway.auth.token, "new-token");
  // Access policy is orchestrator-owned: legacy channel (no dmAccess) stays open, runtime value does not win.
  assert.equal(patched.channels.whatsapp.dmPolicy, "open");
  assert.deepEqual(patched.channels.whatsapp.allowFrom, ["*"]);
  assert.match(
    await readTarEntry(configArchive, ".openclaw/.env"),
    /^LITELLM_API_KEY=litellm-key$/m,
  );
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

const instanceConfig: InstanceConfig = {
  displayName: "Restored",
  provider: liteLlmConfig.provider,
  channels: [{ type: "whatsapp" }],
  resources: { memoryMb: 4096, cpuShares: 512 },
};

const instance: Instance = {
  id: "4b86fc8b-ef19-496b-9591-583c72069443",
  userId: "user_1",
  hostId: "local-dev",
  runtimeKind: "openclaw",
  displayName: "Restored",
  status: "running",
  config: instanceConfig,
  containerId: "container-1",
  containerName: "openclaw-4b86fc8b",
  gatewayPort: 19000,
  gatewayToken: "new-token",
  healthFailures: 0,
  errorMessage: null,
  pairingStatus: "paired",
  whatsappAccountId: "972555555555",
  hasWhatsappCreds: true,
  lastSeenAt: null,
  backupImport: {
    status: "none",
    objectName: null,
    contentLength: null,
    contentType: null,
  },
  litellm: {
    keyAlias: null,
    keyHash: null,
    budgetCents: null,
    budgetDuration: null,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  stoppedAt: null,
  destroyedAt: null,
};

const existingConfig = {
  agents: {
    defaults: {
      model: { primary: "google35/gemini-3.5-flash" },
      workspace: "/home/node/.openclaw/workspace",
      maxConcurrent: 2,
    },
    list: [{ id: "main", default: true }],
  },
  models: {
    providers: {
      google35: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        api: "google-generative-ai",
        models: [{ id: "gemini-3.5-flash" }],
      },
    },
  },
  gateway: {
    port: 18789,
    mode: "local",
    bind: "lan",
    auth: { mode: "token", token: "old-token" },
  },
  channels: {
    whatsapp: {
      enabled: true,
      dmPolicy: "open",
      allowFrom: ["9725"],
      defaultAccount: "default",
      accounts: {
        default: {
          enabled: true,
          authDir: "/home/node/.openclaw/whatsapp-session",
        },
      },
    },
  },
  session: { dmScope: "main" },
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

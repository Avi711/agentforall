import { test } from "node:test";
import assert from "node:assert/strict";
import tar from "tar-stream";
import { OpenClawRuntimeAdapter } from "../src/services/agent-runtime/openclaw/adapter.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { Instance, InstanceConfig } from "../src/domain/types.js";
import { UpstreamUnavailableError, ValidationError } from "../src/domain/errors.js";

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
        audio?: {
          models: { provider: string; model: string; baseUrl?: string; capabilities?: string[] }[];
        };
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
  assert.equal(config.models?.providers.litellm?.api, "openai-completions");
  assert.equal(
    config.models?.providers.litellm?.baseUrl,
    "https://litellm-gateway.example/v1",
  );
  assert.equal(config.models?.providers.litellm?.apiKey, "${LITELLM_API_KEY}");
  assert.deepEqual(config.models?.providers.litellm?.models[0], {
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
  // Audio goes through our plugin provider: OpenClaw only lets plugin-backed providers transcribe.
  assert.deepEqual(config.tools?.media?.audio?.models[0], {
    provider: "agentforall-media",
    model: "gemini-agentforall",
    capabilities: ["audio"],
    baseUrl: "https://litellm-gateway.example/v1",
  });
  // No video block on a gateway provider: OpenClaw has nothing that would answer it.
  assert.equal(config.tools?.media?.video, undefined);
  assert.equal(config.tools?.media?.pdf, undefined);
  assert.deepEqual(config.web?.whatsapp, {
    keepAliveIntervalMs: 15000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
  });
  assert.match(files.dotEnv, /^LITELLM_API_KEY=litellm-key$/m);
  // The plugin reads its own variables: the model client's key name follows the provider id.
  assert.match(files.dotEnv, /^AGENTFORALL_MEDIA_BASE_URL=https:\/\/litellm-gateway\.example\/v1$/m);
  assert.match(files.dotEnv, /^AGENTFORALL_MEDIA_API_KEY=litellm-key$/m);
});

// Any provider with a baseUrl is a config provider, which OpenClaw registers for image only —
// LiteLLM is just the one we run. A gateway under another name must get the same treatment.
test("a gateway provider under any name transcribes through the plugin", () => {
  const adapter = new OpenClawRuntimeAdapter({} as ContainerRuntime, "openclaw-image");
  const files = adapter.generateConfig(
    {
      ...liteLlmConfig,
      provider: {
        name: "openai",
        id: "proxy",
        apiKey: "proxy-key",
        model: "gpt-5.5",
        baseUrl: "https://proxy.example/v1",
        media: ["image", "audio", "video"],
      },
    },
    "gateway-token",
  );
  const config = JSON.parse(files.configJson) as {
    tools?: {
      media?: {
        image?: { models: { provider: string }[] };
        audio?: { models: { provider: string; model: string; baseUrl?: string }[] };
        video?: unknown;
      };
    };
  };

  assert.equal(config.tools?.media?.image?.models[0]?.provider, "proxy");
  assert.deepEqual(config.tools?.media?.audio?.models[0], {
    provider: "agentforall-media",
    model: "gpt-5.5",
    capabilities: ["audio"],
    baseUrl: "https://proxy.example/v1",
  });
  assert.equal(config.tools?.media?.video, undefined);
  assert.match(files.dotEnv, /^AGENTFORALL_MEDIA_API_KEY=proxy-key$/m);
  // The credit plugin reads LiteLLM's own /key/info, so it must not follow the gateway rule.
  assert.equal(files.dotEnv.includes("AGENTFORALL_CREDIT_"), false);
});

// The plugin exists for gateway providers. A bot on a direct provider must keep the provider
// OpenClaw transcribes with itself, or it would call a plugin that has no key for that vendor.
test("a bot on a direct provider keeps OpenClaw's own audio provider", () => {
  const adapter = new OpenClawRuntimeAdapter({} as ContainerRuntime, "openclaw-image");
  const files = adapter.generateConfig(
    {
      ...liteLlmConfig,
      provider: {
        name: "anthropic",
        apiKey: "anthropic-key",
        model: "claude-sonnet-5",
        media: ["image", "audio", "video"],
      },
    },
    "gateway-token",
  );
  const config = JSON.parse(files.configJson) as {
    tools?: {
      media?: {
        audio?: { models: { provider: string; model: string; baseUrl?: string }[] };
        video?: { models: { provider: string }[] };
      };
    };
  };

  assert.deepEqual(config.tools?.media?.audio?.models[0], {
    provider: "anthropic",
    model: "claude-sonnet-5",
    capabilities: ["audio"],
  });
  assert.equal(config.tools?.media?.video?.models[0]?.provider, "anthropic");
  assert.equal(files.dotEnv.includes("AGENTFORALL_MEDIA_"), false);
});

test("a bot whose plan carries no audio gets no audio block", () => {
  const adapter = new OpenClawRuntimeAdapter({} as ContainerRuntime, "openclaw-image");
  const files = adapter.generateConfig(
    { ...liteLlmConfig, provider: { ...liteLlmConfig.provider, media: ["image"] } },
    "gateway-token",
  );
  const config = JSON.parse(files.configJson) as { tools?: { media?: { audio?: unknown } } };

  assert.equal(config.tools?.media?.audio, undefined);
});

interface SentConfig {
  agents: { defaults: { model: { primary: string } } };
  models: { providers: Record<string, { baseUrl?: string } | undefined> };
  session: unknown;
  gateway: { auth: { token: string } };
  channels: { whatsapp: { dmPolicy: string; allowFrom: string[] } };
}

const failure = (fields: Record<string, unknown>) => JSON.stringify({ ok: false, ...fields });
// What the adapter would write, so a container whose env already matches reports "applied".
const desiredConfig = () =>
  new OpenClawRuntimeAdapter({} as ContainerRuntime, "openclaw-image").generateConfig(
    instanceConfig,
    "new-token",
  ).configJson;
const currentEnv = () =>
  new OpenClawRuntimeAdapter({} as ContainerRuntime, "openclaw-image").generateConfig(
    instanceConfig,
    "new-token",
  ).dotEnv;

test("a live change goes to the gateway carrying the merged config, not a file write", async () => {
  const live = liveRuntime();
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "applied");

  const sent = live.sent() as SentConfig;
  assert.equal(sent.agents.defaults.model.primary, "litellm/gemini-agentforall");
  assert.equal(sent.models.providers.litellm?.baseUrl, "https://litellm-gateway.example/v1");
  assert.equal(sent.models.providers.google35, undefined);
  assert.deepEqual(sent.session, { dmScope: "per-peer" });
  assert.equal(sent.gateway.auth.token, "new-token");
  // Access policy is orchestrator-owned: legacy channel (no dmAccess) stays open.
  assert.equal(sent.channels.whatsapp.dmPolicy, "open");
  assert.deepEqual(sent.channels.whatsapp.allowFrom, ["*"]);

  const command = live.commands.find((cmd) => cmd[0] === "node");
  assert.deepEqual(command?.slice(0, 2), ["node", "-e"]);
  assert.match(String(command?.[2]), /config\.apply/);
  assert.match(String(command?.[2]), /operator\.admin/);
});

// Only .env is staged on success: the gateway owns openclaw.json once it has accepted the change.
test("an applied change stages env for the next boot and nothing else", async () => {
  const live = liveRuntime();
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await adapter.applyConfig("container-1", instance);

  const archive = live.archive();
  assert.match(await readTarEntry(archive, ".openclaw/.env"), /^LITELLM_API_KEY=litellm-key$/m);
  await assert.rejects(readTarEntry(archive, ".openclaw/openclaw.json"));
});

test("a config the gateway rejected fails loudly and writes nothing", async () => {
  const live = liveRuntime({
    applyResult: failure({ stage: "write", transport: false, code: "INVALID_REQUEST", message: "must be boolean" }),
  });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await assert.rejects(adapter.applyConfig("container-1", instance), ValidationError);
  assert.equal(live.archiveOrNull(), null);
});

// A write can land and lose its acknowledgement, so the live config decides — not the missing answer.
test("a lost acknowledgement is resolved by reading the live config", async () => {
  const live = liveRuntime({
    applyResult: failure({ stage: "write", transport: false, code: "UNAVAILABLE", message: "rate limit exceeded" }),
    liveConfigHoldsChange: true,
  });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "applied");
  assert.match(await readTarEntry(live.archive(), ".openclaw/.env"), /LITELLM_API_KEY/);
});

test("a change that neither landed nor was refused fails retryably and writes nothing", async () => {
  for (const applyResult of [
    failure({ stage: "write", transport: false, code: "UNAVAILABLE", message: "rate limit exceeded" }),
    failure({ stage: "read", transport: false, code: "NOT_READY", message: "still starting" }),
    "unreadable output",
  ]) {
    const live = liveRuntime({ applyResult });
    const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

    await assert.rejects(adapter.applyConfig("container-1", instance), UpstreamUnavailableError);
    assert.equal(live.archiveOrNull(), null);
  }
});

// The program never ran, so the gateway holds no opinion: stage the file and let the restart
// deliver it rather than dropping the change.
test("an exec that could not run stages the config for a restart", async () => {
  for (const live of [
    liveRuntime({ applyExitCode: 1, applyStderr: "OCI runtime exec failed" }),
    liveRuntime({ applyThrows: new Error("docker daemon unavailable") }),
  ]) {
    const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");
    assert.equal(await adapter.applyConfig("container-1", instance), "restart_required");
    await readTarEntry(live.archive(), ".openclaw/openclaw.json");
  }
});

// Gateway prose can quote the config it refused, and that config carries every channel secret.
test("no secret from the config reaches the error message", async () => {
  const live = liveRuntime({
    applyResult: failure({
      stage: "write",
      transport: false,
      code: "INVALID_REQUEST",
      message: "invalid near new-token and telegram-secret and openai-key and relay-secret",
    }),
  });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");
  const withSecrets: Instance = {
    ...instance,
    config: {
      ...instanceConfig,
      integrations: { relayToken: "relay-secret", relayUrl: "http://orchestrator:3000/api/v1/mcp/x" },
      provider: { ...instanceConfig.provider, apiKey: "openai-key" },
      channels: [
        { type: "whatsapp" },
        { type: "telegram", botToken: "telegram-secret", dmPolicy: "allowlist", allowFrom: ["tg:1"] },
      ],
    },
  };

  const error = await adapter.applyConfig("container-1", withSecrets).then(
    () => null,
    (err: unknown) => err,
  );
  assert.ok(error instanceof Error);
  for (const secret of ["new-token", "telegram-secret", "openai-key", "relay-secret"]) {
    assert.doesNotMatch(error.message, new RegExp(secret));
  }
});

// A change that only moves .env is not live until the runtime restarts, so it must never be
// reported as applied — the env file is read once at start-up.
test("a change the running gateway cannot make live asks for a restart", async () => {
  const live = liveRuntime({ envOnDisk: "LITELLM_API_KEY=a-previous-key\n" });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "restart_required");
});

test("a change that is fully live reports applied", async () => {
  const live = liveRuntime();
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "applied");
});

// A running container whose config cannot be read is not a stopped container: staging a file it
// will never read is how a change disappears silently.
test("a running container that cannot be read is never reported as staged", async () => {
  const live = liveRuntime({ configReadThrows: new Error("exec timeout") });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await assert.rejects(adapter.applyConfig("container-1", instance), UpstreamUnavailableError);
  assert.equal(live.archiveOrNull(), null);
});

// The question is whether the agent HOLDS the config, not whether this particular write put it
// there: a retry after a partial failure must succeed, not fail forever.
test("a config the container already holds is reported applied, not failed", async () => {
  const live = liveRuntime({
    applyResult: failure({ stage: "write", transport: false, code: "UNAVAILABLE", message: "rate limit exceeded" }),
    changeIsNoop: true,
  });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "applied");
});

// No session with the gateway is not the same as a gateway that refused: staging the file and
// restarting is how the change still reaches the agent.
test("a gateway that cannot be reached stages the config for a restart", async () => {
  const live = liveRuntime({
    applyResult: failure({ stage: "connect", transport: true, code: null, message: "gateway-disconnected" }),
  });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "restart_required");
  const written = JSON.parse(await readTarEntry(live.archive(), ".openclaw/openclaw.json")) as {
    channels: { whatsapp: Record<string, unknown> };
  };
  assert.equal(written.channels.whatsapp.runtimeOnlyKey, "keep-me");
});

// A gateway that answered but never ruled still gets no blind write.
test("a gateway that gave no verdict and does not hold the config fails retryably", async () => {
  const live = liveRuntime({
    applyResult: failure({ stage: "write", transport: false, code: "UNAVAILABLE", message: "rate limit exceeded" }),
  });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await assert.rejects(adapter.applyConfig("container-1", instance), UpstreamUnavailableError);
  assert.equal(live.archiveOrNull(), null);
});

// Nothing the runtime reads changed, so there is no reason to spend a gateway write on it.
test("a change the container already matches never touches the gateway", async () => {
  const live = liveRuntime({ changeIsNoop: true });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  assert.equal(await adapter.applyConfig("container-1", instance), "applied");
  assert.deepEqual(live.commands.filter((cmd) => cmd[0] === "node"), []);
});

// Nothing is running to accept the change, so the file its next boot reads is the way in.
test("a stopped container is staged, never reported as applied", async () => {
  let archive: Buffer | null = null;
  const runtime = {
    isRunning: async () => false,
    readFile: async () => Buffer.from(JSON.stringify(existingConfig)),
    execCommandBuffer: async () => {
      throw new Error("exec must not be attempted on a stopped container");
    },
    putArchive: async (_id: string, _path: string, content: Buffer) => {
      archive = content;
    },
  } as unknown as ContainerRuntime;

  const adapter = new OpenClawRuntimeAdapter(runtime, "openclaw-image");
  assert.equal(await adapter.applyConfig("container-1", instance), "restart_required");

  assert.ok(archive);
  const written = JSON.parse(
    await readTarEntry(archive, ".openclaw/openclaw.json"),
  ) as typeof existingConfig;
  assert.equal(written.gateway.auth.token, "new-token");
  assert.match(await readTarEntry(archive, ".openclaw/.env"), /^LITELLM_API_KEY=litellm-key$/m);
});

// Callers that restart afterwards stage the file, and it must carry the runtime's own state.
test("writeConfig preserves runtime-written config on a running container", async () => {
  const live = liveRuntime();
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await adapter.writeConfig("container-1", instance);

  const written = JSON.parse(await readTarEntry(live.archive(), ".openclaw/openclaw.json")) as {
    channels: { whatsapp: Record<string, unknown> };
    gateway: { auth: { token: string } };
  };
  assert.equal(written.channels.whatsapp.runtimeOnlyKey, "keep-me");
  assert.equal(written.gateway.auth.token, "new-token");
});

test("writeConfig never opens the gateway RPC", async () => {
  const live = liveRuntime();
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await adapter.writeConfig("container-1", instance);

  assert.deepEqual(live.commands, []);
});

// start / restart / restore all stage the config while the container is down. Reading it only
// over exec meant they saw nothing and wrote the pristine file, erasing everything the tenant had.
test("staging a stopped container keeps the config it already has", async () => {
  let archive: Buffer | null = null;
  const tenantEdited = {
    ...existingConfig,
    browser: { headless: false },
    channels: {
      ...existingConfig.channels,
      whatsapp: { ...existingConfig.channels.whatsapp, groups: { "-42": { requireMention: false } } },
    },
  };
  const runtime = {
    isRunning: async () => false,
    readFile: async () => Buffer.from(JSON.stringify(tenantEdited)),
    putArchive: async (_id: string, _path: string, content: Buffer) => {
      archive = content;
    },
  } as unknown as ContainerRuntime;

  await new OpenClawRuntimeAdapter(runtime, "openclaw-image").writeConfig("container-1", instance);

  assert.ok(archive);
  const written = JSON.parse(await readTarEntry(archive, ".openclaw/openclaw.json")) as {
    browser: { headless: boolean };
    channels: { whatsapp?: { groups?: unknown } };
  };
  assert.equal(written.browser.headless, false);
  assert.deepEqual(written.channels.whatsapp?.groups, { "-42": { requireMention: false } });
});

// A container created moments ago has no config yet; that is the one time the pristine file is
// the right thing to write.
test("a container with no config yet gets the freshly generated one", async () => {
  let archive: Buffer | null = null;
  const runtime = {
    isRunning: async () => false,
    readFile: async () => null,
    putArchive: async (_id: string, _path: string, content: Buffer) => {
      archive = content;
    },
  } as unknown as ContainerRuntime;

  await new OpenClawRuntimeAdapter(runtime, "openclaw-image").writeConfig("container-1", instance);

  assert.ok(archive);
  const written = JSON.parse(await readTarEntry(archive, ".openclaw/openclaw.json")) as {
    gateway: { auth: { token: string } };
    browser: { headless: boolean };
  };
  assert.equal(written.gateway.auth.token, "new-token");
  assert.equal(written.browser.headless, true);
});

// Applying a change to a container we cannot read from would mean guessing at its config.
test("a live change to a container with no readable config fails loudly", async () => {
  const live = liveRuntime({ configMissing: true });
  const adapter = new OpenClawRuntimeAdapter(live.runtime, "openclaw-image");

  await assert.rejects(() => adapter.applyConfig("container-1", instance), /no config/);
  assert.deepEqual(live.commands, []);
});

function liveRuntime(
  options: {
    applyResult?: string;
    applyExitCode?: number;
    applyStderr?: string;
    applyThrows?: Error;
    liveConfigHoldsChange?: boolean;
    changeIsNoop?: boolean;
    configReadThrows?: Error;
    configMissing?: boolean;
    envOnDisk?: string | null;
    envReadThrows?: Error;
  } = {},
) {
  const commands: string[][] = [];
  let sentConfig: string | null = null;
  let archive: Buffer | null = null;

  const reads: string[] = [];

  const runtime = {
    isRunning: async () => true,
    readFile: async (_containerId: string, path: string) => {
      reads.push(path);
      if (path.endsWith(".env")) {
        if (options.envReadThrows) throw options.envReadThrows;
        return options.envOnDisk === null ? null : Buffer.from(options.envOnDisk ?? currentEnv());
      }
      if (options.configReadThrows) throw options.configReadThrows;
      if (options.configMissing) return null;
      // A no-op change is already in place before the write, so a read-back proves nothing.
      const base = options.changeIsNoop ? desiredConfig() : JSON.stringify(existingConfig);
      // The verification read sees whatever the gateway ended up holding.
      return Buffer.from(options.liveConfigHoldsChange && sentConfig !== null ? sentConfig : base);
    },
    execCommandBuffer: async (
      _containerId: string,
      cmd: string[],
      _timeoutMs: number,
      _maxBytes: number,
      input?: Buffer,
    ) => {
      commands.push(cmd);
      if (options.applyThrows) throw options.applyThrows;
      sentConfig = input?.toString("utf8") ?? null;
      return {
        exitCode: options.applyExitCode ?? 0,
        stdout: Buffer.from(options.applyResult ?? '{"ok":true}'),
        stderr: options.applyStderr ?? "",
      };
    },
    putArchive: async (_id: string, _path: string, content: Buffer) => {
      archive = content;
    },
  } as unknown as ContainerRuntime;

  return {
    runtime,
    commands,
    reads,
    sent: () => JSON.parse(sentConfig ?? "null") as unknown,
    archive: () => {
      assert.ok(archive);
      return archive;
    },
    archiveOrNull: () => archive,
  };
}

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
      runtimeOnlyKey: "keep-me",
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

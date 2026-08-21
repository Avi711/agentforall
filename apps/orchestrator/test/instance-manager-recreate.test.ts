import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager } from "../src/services/instance-manager.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";
import type { Instance } from "../src/domain/types.js";

test("recreate replaces the container and preserves the state volume", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter());

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.stoppedContainers, ["container-1"]);
  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.deepEqual(runtime.createdContainers, ["container-2"]);
  assert.deepEqual(runtime.startedContainers, ["container-2"]);
  assert.deepEqual(runtime.removedVolumes, []);
  assert.equal(repo.instance.containerId, "container-2");
  assert.equal(repo.instance.status, "running");
});

test("recreate injects whatsapp creds before start when paired", async () => {
  const repo = new FakeRepo({ ...baseInstance, hasWhatsappCreds: true });
  const runtime = new FakeRuntime();
  const injected: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter(),
    injectWhatsappSession: async (containerId: string) => {
      injected.push(containerId);
    },
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.deepEqual(injected, ["container-2"]);
  assert.ok(
    runtime.startedContainers.length === 1,
    "container started after creds injection",
  );
});

test("recreate marks error when the new container cannot be created", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, {
    ...adapter(),
    buildContainerOptions: async () => {
      throw new Error("image pull failed");
    },
  });

  await assert.rejects(
    () => manager.recreate(baseInstance.id, baseInstance.userId),
    /image pull failed/,
  );

  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.equal(repo.instance.status, "error");
});

test("recreate rejects invalid states", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "provisioning" });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter());

  await assert.rejects(() =>
    manager.recreate(baseInstance.id, baseInstance.userId),
  );
  assert.deepEqual(runtime.removedContainers, []);
});

class FakeRepo {
  constructor(public instance: Instance) {}

  async findById(id: string): Promise<Instance | null> {
    return id === this.instance.id ? this.instance : null;
  }

  async updateStatus(
    _id: string,
    status: Instance["status"],
    _options?: { expectedStatus?: Instance["status"]; errorMessage?: string },
  ): Promise<boolean> {
    this.instance = { ...this.instance, status };
    return true;
  }

  async updateContainerId(_id: string, containerId: string): Promise<void> {
    this.instance = { ...this.instance, containerId };
  }

  async getDecryptedWhatsappCreds(): Promise<Buffer | null> {
    return this.instance.hasWhatsappCreds ? Buffer.from("creds") : null;
  }
}

class FakeRuntime {
  readonly stoppedContainers: string[] = [];
  readonly removedContainers: string[] = [];
  readonly createdContainers: string[] = [];
  readonly startedContainers: string[] = [];
  readonly createdVolumes: string[] = [];
  readonly removedVolumes: string[] = [];

  async isRunning(): Promise<boolean> {
    return true;
  }

  async stop(containerId: string): Promise<void> {
    this.stoppedContainers.push(containerId);
  }

  async remove(containerId: string): Promise<void> {
    this.removedContainers.push(containerId);
  }

  async create(): Promise<string> {
    this.createdContainers.push("container-2");
    return "container-2";
  }

  async start(containerId: string): Promise<void> {
    this.startedContainers.push(containerId);
  }

  async inspect(): Promise<null> {
    return null;
  }

  async findContainerByName(): Promise<null> {
    return null;
  }

  async ensureVolumeExists(name: string): Promise<void> {
    this.createdVolumes.push(name);
  }

  async removeVolume(name: string): Promise<void> {
    this.removedVolumes.push(name);
  }
}

function adapter(): AgentRuntimeAdapter {
  return {
    kind: "openclaw",
    image: "openclaw-image",
    maxBackupBytes: 1024,
    containerName: (id) => `openclaw-${id.slice(0, 12)}`,
    stateVolumeName: (id) => `oc-${id.slice(0, 12)}-state`,
    buildContainerOptions: async () => ({}) as never,
    generateConfig: () => ({ configJson: "{}", dotEnv: "" }),
    refreshConfig: async () => {},
    injectWhatsappSession: async () => {},
    exportState: async () => {
      throw new Error("not implemented");
    },
    restoreState: async () => {},
    probe: async () => ({ gatewayHealthy: true, whatsappState: "unknown" }),
    logoutWhatsapp: async () => true,
    listWhatsappPairingRequests: async () => [],
  };
}

function createManager(
  repo: FakeRepo,
  runtime: FakeRuntime,
  adapterImpl: AgentRuntimeAdapter,
): InstanceManager {
  const registry = {
    get: () => adapterImpl,
  } as unknown as AgentRuntimeRegistry;
  return new InstanceManager(
    repo as never,
    runtime as unknown as ContainerRuntime,
    registry,
    {} as never,
    { maxProvisionRetries: 3 } as AppConfig,
    { append: async () => {} } as never,
    {
      logoutWhatsapp: async () => {},
      teardownSidecar: async () => {},
    } as never,
    {
      revoke: async () => {},
      revokeKey: async () => {},
    } as never,
    fakeLogger,
  );
}

const fakeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as FastifyBaseLogger;

const baseInstance: Instance = {
  id: "4b86fc8b-ef19-496b-9591-583c72069443",
  userId: "user_1",
  hostId: "local-dev",
  runtimeKind: "openclaw",
  displayName: "Recreate",
  status: "running",
  config: {
    displayName: "Recreate",
    provider: {
      name: "litellm",
      apiKey: "key",
      model: "gemini-agentforall",
      baseUrl: "https://litellm.example/v1",
    },
    channels: [{ type: "whatsapp" }],
    resources: { memoryMb: 4096, cpuShares: 512 },
  },
  containerId: "container-1",
  containerName: "openclaw-4b86fc8b-ef1",
  gatewayPort: 19000,
  gatewayToken: "gateway-token",
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

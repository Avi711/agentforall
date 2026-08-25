import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager } from "../src/services/instance-manager.js";
import { Reconciler } from "../src/services/reconciler.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";
import type { Instance } from "../src/domain/types.js";

test("destroy removes the runtime state volume even for errored instances", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "error" });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, openclawAdapter);

  await manager.destroy(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.deepEqual(runtime.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(repo.instance.status, "destroyed");
  // Errored rows already released their gateway port; passing through `destroying` re-claims it.
  assert.deepEqual(repo.statusHistory, ["destroyed"]);
});

test("destroy completes cleanup when the row is already destroying", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "destroying" });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, openclawAdapter);

  await manager.destroy(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.deepEqual(runtime.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(repo.instance.status, "destroyed");
});

test("failed provisioning removes the runtime state volume after creating it", async () => {
  const repo = new FakeRepo({
    ...baseInstance,
    status: "provisioning",
    containerId: null,
  });
  const runtime = new FakeRuntime();
  const failingAdapter = {
    ...openclawAdapter,
    buildContainerOptions: async () => {
      throw new Error("build failed");
    },
  } satisfies AgentRuntimeAdapter;
  const manager = createManager(repo, runtime, failingAdapter);

  await assert.rejects(
    () => manager.resumeProvisioning(baseInstance.id),
    /build failed/,
  );

  assert.deepEqual(runtime.createdVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.deepEqual(runtime.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(repo.instance.status, "error");
});

test("reconciler removes state volume before resolving orphaned destroys", async () => {
  const repo = new FakeReconcilerRepo({ ...baseInstance, status: "destroying" });
  const runtime = new FakeRuntime();
  const registry = {
    get: () => openclawAdapter,
  } as unknown as AgentRuntimeRegistry;
  const reconciler = new Reconciler({
    repo: repo as never,
    runtime: runtime as unknown as ContainerRuntime,
    runtimes: registry,
    manager: {} as never,
    pairingManager: { expireStale: async () => {} } as never,
    logger: fakeLogger,
    pairingStaleThresholdMs: 60_000,
  });

  await reconciler.run();

  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.deepEqual(runtime.removedVolumes, ["oc-4b86fc8b-ef1-state"]);
  assert.equal(repo.instance.status, "destroyed");
});

class FakeRepo {
  readonly statusHistory: Instance["status"][] = [];

  constructor(public instance: Instance) {}

  async findById(id: string): Promise<Instance | null> {
    return id === this.instance.id ? this.instance : null;
  }

  async updateStatus(
    _id: string,
    status: Instance["status"],
    _options?: { expectedStatus?: Instance["status"]; errorMessage?: string },
  ): Promise<boolean> {
    this.statusHistory.push(status);
    this.instance = {
      ...this.instance,
      status,
      destroyedAt:
        status === "destroyed" ? new Date() : this.instance.destroyedAt,
    };
    return true;
  }

  async updatePairing(): Promise<boolean> {
    this.instance = {
      ...this.instance,
      hasWhatsappCreds: false,
      pairingStatus: "none",
      whatsappAccountId: null,
    };
    return true;
  }

  async updateContainerId(_id: string, containerId: string): Promise<void> {
    this.instance = { ...this.instance, containerId };
  }
}

class FakeReconcilerRepo extends FakeRepo {
  async findStaleProvisioning(): Promise<Instance[]> {
    return [];
  }

  async findByStatuses(statuses: Instance["status"][]): Promise<Instance[]> {
    return statuses.includes(this.instance.status) ? [this.instance] : [];
  }
}

class FakeRuntime {
  readonly createdVolumes: string[] = [];
  readonly removedVolumes: string[] = [];
  readonly removedContainers: string[] = [];

  async ensureVolumeExists(name: string): Promise<void> {
    this.createdVolumes.push(name);
  }

  async removeVolume(name: string): Promise<void> {
    this.removedVolumes.push(name);
  }

  async remove(containerId: string): Promise<void> {
    this.removedContainers.push(containerId);
  }

  async inspect(): Promise<null> {
    return null;
  }

  async findContainerByName(): Promise<null> {
    return null;
  }
}

const openclawAdapter: AgentRuntimeAdapter = {
  kind: "openclaw",
  image: "openclaw-image",
  maxBackupBytes: 1024,
  containerName: (id) => `openclaw-${id.slice(0, 12)}`,
  stateVolumeName: (id) => `oc-${id.slice(0, 12)}-state`,
  buildContainerOptions: async () => {
    throw new Error("not implemented");
  },
  generateConfig: () => ({ configJson: "{}", dotEnv: "" }),
  writeConfig: async () => {},
  applyConfig: async () => "applied" as const,
  injectWhatsappSession: async () => {},
  exportState: async () => {
    throw new Error("not implemented");
  },
  restoreState: async () => {},
  probeGateway: async () => ({ healthy: true, degraded: null }),
  probeWhatsapp: async () => "unknown" as const,
  logoutWhatsapp: async () => true,
  listWhatsappPairingRequests: async () => [],
  readOwnerIds: async () => [],
};

function createManager(
  repo: FakeRepo,
  runtime: FakeRuntime,
  adapter: AgentRuntimeAdapter,
): InstanceManager {
  const registry = {
    get: () => adapter,
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
  displayName: "Cleanup",
  status: "running",
  config: {
    displayName: "Cleanup",
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

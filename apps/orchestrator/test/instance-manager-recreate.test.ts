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

// The volume was written by the old image; the new one refuses to boot it until it is migrated,
// and the migration must run with nothing else on the volume. The old container is kept until it
// succeeded, and the config is written after create so the file already there is patched.
test("recreate migrates the stopped volume before removing the old container", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const order: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter(),
    prepareState: async () => {
      order.push(
        `prepare:stopped=${runtime.stoppedContainers.length}:removed=${runtime.removedContainers.length}:created=${runtime.createdContainers.length}`,
      );
    },
    writeConfig: async (containerId) => {
      order.push(`config:${containerId}:started=${runtime.startedContainers.length}`);
    },
    seedWorkspace: async (containerId) => {
      order.push(`seed:${containerId}:started=${runtime.startedContainers.length}`);
    },
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.deepEqual(order, [
    "prepare:stopped=1:removed=0:created=0",
    "config:container-2:started=0",
    "seed:container-2:started=0",
  ]);
  assert.deepEqual(runtime.removedContainers, ["container-1"]);
});

test("a migration failure keeps the old container and marks the bot error", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, {
    ...adapter(),
    prepareState: async () => {
      throw new Error("doctor exited 1");
    },
  });

  await assert.rejects(() => manager.recreate(baseInstance.id, baseInstance.userId), /doctor exited 1/);
  assert.deepEqual(runtime.removedContainers, []);
  assert.deepEqual(runtime.createdContainers, []);
  assert.equal(repo.instance.containerId, "container-1");
  assert.equal(repo.instance.status, "error");
});

// A crash between create and the config write leaves a container under the bot's name that the
// row does not know. An explicit recreate replaces it like any other, and the replacement is configured.
test("a retried recreate replaces the container the last attempt left behind and configures the new one", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "error", containerId: null });
  const runtime = new FakeRuntime({ byName: "container-2" });
  const writes: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter(),
    writeConfig: async (containerId) => {
      writes.push(containerId);
    },
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.removedContainers, ["container-2"]);
  assert.deepEqual(runtime.createdContainers, ["container-2"]);
  assert.deepEqual(writes, ["container-2"]);
  assert.equal(repo.instance.containerId, "container-2");
  assert.equal(repo.instance.status, "running");
});

// The integrations tool has to be in every container; bots that predate the binding get it on the
// recreate that moves them to the current image. No provider call is involved.
test("recreate binds the relay for a bot created before it was bound at creation", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter(), {
    integrationsProvider: "mock",
    orchestratorInternalUrl: "http://orchestrator:3000",
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  const binding = repo.instance.config.integrations;
  assert.equal(binding?.relayUrl, `http://orchestrator:3000/api/v1/mcp/${baseInstance.id}`);
  assert.match(binding?.relayToken ?? "", /^[0-9a-f]{64}$/);
});

test("recreate keeps an existing relay binding", async () => {
  const integrations = { relayToken: "existing", relayUrl: "http://orchestrator:3000/api/v1/mcp/x" };
  const repo = new FakeRepo({ ...baseInstance, config: { ...baseInstance.config, integrations } });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter(), {
    integrationsProvider: "mock",
    orchestratorInternalUrl: "http://orchestrator:3000",
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.deepEqual(repo.instance.config.integrations, integrations);
  assert.deepEqual(repo.configWrites, []);
});

// A stopped bot on the old image would boot into a config its runtime rejects; starting it is
// where it catches up with the fleet.
test("start rebuilds a stopped container that predates the current image", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "stopped" });
  const runtime = new FakeRuntime();
  const prepared: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter({ staleImage: true }),
    prepareState: async (inst) => {
      prepared.push(inst.id);
    },
  });

  await manager.start(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.deepEqual(prepared, [baseInstance.id]);
  assert.deepEqual(runtime.startedContainers, ["container-2"]);
  assert.equal(repo.instance.containerId, "container-2");
  assert.equal(repo.instance.status, "running");
});

// The rebuild is the same one recreate does, so the relay binding and guidance come with it.
test("start's rebuild binds the relay and seeds the workspace", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "stopped" });
  const runtime = new FakeRuntime();
  const seeded: string[] = [];
  const manager = createManager(
    repo,
    runtime,
    {
      ...adapter({ staleImage: true }),
      seedWorkspace: async (containerId) => {
        seeded.push(containerId);
      },
    },
    { integrationsProvider: "mock", orchestratorInternalUrl: "http://orchestrator:3000" },
  );

  await manager.start(baseInstance.id, baseInstance.userId);

  assert.deepEqual(seeded, ["container-2"]);
  assert.match(repo.instance.config.integrations?.relayToken ?? "", /^[0-9a-f]{64}$/);
});

// A doctor failure on the way up must leave the bot exactly as it was: stopped, old container
// intact, startable again once the cause is fixed.
test("a migration failure on start keeps the stopped container and the stopped status", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "stopped" });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, {
    ...adapter({ staleImage: true }),
    prepareState: async () => {
      throw new Error("doctor exited 1");
    },
  });

  await assert.rejects(() => manager.start(baseInstance.id, baseInstance.userId), /doctor exited 1/);
  assert.deepEqual(runtime.removedContainers, []);
  assert.deepEqual(runtime.startedContainers, []);
  assert.equal(repo.instance.containerId, "container-1");
  assert.equal(repo.instance.status, "stopped");
});

test("restart rebuilds a running container that predates the current image", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter({ staleImage: true }));

  await manager.restart(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.stoppedContainers, ["container-1"]);
  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.deepEqual(runtime.startedContainers, ["container-2"]);
  assert.deepEqual(runtime.restartedContainers, []);
  assert.equal(repo.instance.containerId, "container-2");
});

// The rebuild can take longer than the reconciler waits before it marks the row stopped. The
// container is up at the end, so the row must say running whatever happened to it meanwhile.
test("a rebuild the reconciler raced with still ends running", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "stopped" });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, {
    ...adapter({ staleImage: true }),
    prepareState: async () => {
      repo.markStopped();
    },
  });

  await manager.start(baseInstance.id, baseInstance.userId);

  assert.equal(repo.instance.status, "running");
  assert.equal(repo.instance.containerId, "container-2");
});

test("a recreate the reconciler raced with still ends running", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, {
    ...adapter({ staleImage: true }),
    prepareState: async () => {
      repo.markStopped();
    },
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.equal(repo.instance.status, "running");
  assert.equal(repo.instance.containerId, "container-2");
});

test("a migration failure on restart marks the bot error with the cause", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, {
    ...adapter({ staleImage: true }),
    prepareState: async () => {
      throw new Error("doctor exited 1");
    },
  });

  await assert.rejects(() => manager.restart(baseInstance.id, baseInstance.userId), /doctor exited 1/);
  assert.equal(repo.instance.status, "error");
  assert.match(repo.instance.errorMessage ?? "", /doctor exited 1/);
  assert.deepEqual(runtime.removedContainers, []);
});

// A crash after the old container was removed but before the row learned the new id: the retry
// finds the replacement by name and must not treat the stale id as a container to migrate again.
test("a retried rebuild adopts the replacement found by name", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "stopped", containerId: "container-gone" });
  const runtime = new FakeRuntime({ byName: "container-2" });
  const prepared: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter({ staleContainers: ["container-gone"] }),
    prepareState: async (inst) => {
      prepared.push(inst.id);
    },
  });

  await manager.start(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.createdContainers, []);
  assert.deepEqual(runtime.removedContainers, []);
  assert.deepEqual(prepared, []);
  assert.deepEqual(runtime.startedContainers, ["container-2"]);
  assert.equal(repo.instance.containerId, "container-2");
});

// A container from the previous orchestrator's image found mid-provision cannot take this
// config; it is replaced and its volume migrated.
test("a found container from another image is replaced, not configured", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "error", containerId: null });
  const runtime = new FakeRuntime({ byName: "container-old" });
  const order: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter({ staleContainers: ["container-old"] }),
    prepareState: async () => {
      order.push(`prepare:removed=${runtime.removedContainers.join(",")}`);
    },
    writeConfig: async (containerId) => {
      order.push(`config:${containerId}`);
    },
  });

  await manager.recreate(baseInstance.id, baseInstance.userId);

  assert.deepEqual(order, ["prepare:removed=", "config:container-2"]);
  assert.deepEqual(runtime.removedContainers, ["container-old"]);
  assert.equal(repo.instance.containerId, "container-2");
});

test("restart of a container on the current image restarts it in place", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter());

  await manager.restart(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.removedContainers, []);
  assert.deepEqual(runtime.restartedContainers, ["container-1"]);
});

test("start reuses a stopped container that is on the current image", async () => {
  const repo = new FakeRepo({ ...baseInstance, status: "stopped" });
  const runtime = new FakeRuntime();
  const manager = createManager(repo, runtime, adapter());

  await manager.start(baseInstance.id, baseInstance.userId);

  assert.deepEqual(runtime.removedContainers, []);
  assert.deepEqual(runtime.startedContainers, ["container-1"]);
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
  readonly configWrites: Instance["config"][] = [];

  constructor(public instance: Instance) {}

  async updateConfig(_id: string, config: Instance["config"]): Promise<void> {
    this.configWrites.push(config);
    this.instance = { ...this.instance, config };
  }

  async findById(id: string): Promise<Instance | null> {
    return id === this.instance.id ? this.instance : null;
  }

  async updateStatus(
    _id: string,
    status: Instance["status"],
    options?: { expectedStatus?: Instance["status"]; errorMessage?: string },
  ): Promise<boolean> {
    if (options?.expectedStatus && options.expectedStatus !== this.instance.status) return false;
    this.instance = { ...this.instance, status, errorMessage: options?.errorMessage ?? null };
    return true;
  }

  // What the reconciler does to a row whose container is not running for too long.
  markStopped(): void {
    this.instance = { ...this.instance, status: "stopped" };
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
  readonly restartedContainers: string[] = [];

  constructor(private readonly options: { byName?: string } = {}) {}

  async isRunning(): Promise<boolean> {
    return true;
  }

  async waitForHealthy(): Promise<boolean> {
    return true;
  }

  async restart(containerId: string): Promise<void> {
    this.restartedContainers.push(containerId);
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

  async inspect(containerId: string): Promise<{ Id: string } | null> {
    return containerId.startsWith("container-") && containerId !== "container-gone" ? { Id: containerId } : null;
  }

  // Like Docker: a removed container frees its name.
  async findContainerByName(): Promise<string | null> {
    const byName = this.options.byName ?? null;
    return byName && !this.removedContainers.includes(byName) ? byName : null;
  }

  async ensureVolumeExists(name: string): Promise<void> {
    this.createdVolumes.push(name);
  }

  async removeVolume(name: string): Promise<void> {
    this.removedVolumes.push(name);
  }
}

// "container-1" is the bot's existing container; staleImage says it was built from another image.
function adapter(options: { staleImage?: boolean; staleContainers?: string[] } = {}): AgentRuntimeAdapter {
  const stale = new Set([...(options.staleImage ? ["container-1"] : []), ...(options.staleContainers ?? [])]);
  return {
    kind: "openclaw",
    image: "openclaw-image",
    maxBackupBytes: 1024,
    containerName: (id) => `openclaw-${id.slice(0, 12)}`,
    stateVolumeName: (id) => `oc-${id.slice(0, 12)}-state`,
    buildContainerOptions: async () => ({}) as never,
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
    readOwnerIds: async () => [],
    listWhatsappPairingRequests: async () => [],
    prepareState: async () => {},
    seedWorkspace: async () => {},
    isOnCurrentImage: async (containerId) => !stale.has(containerId),
  };
}

function createManager(
  repo: FakeRepo,
  runtime: FakeRuntime,
  adapterImpl: AgentRuntimeAdapter,
  config: Partial<AppConfig> = {},
): InstanceManager {
  const registry = {
    get: () => adapterImpl,
  } as unknown as AgentRuntimeRegistry;
  return new InstanceManager(
    repo as never,
    runtime as unknown as ContainerRuntime,
    registry,
    {} as never,
    { maxProvisionRetries: 3, ...config } as AppConfig,
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

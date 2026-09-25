import { test } from "node:test";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager } from "../src/services/instance-manager.js";
import type { ContainerCreateOptions, ContainerRuntime, ContainerState, RestartPolicy } from "../src/services/container-runtime.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";
import type { Instance } from "../src/domain/types.js";
import { singleHost } from "./helpers/host-runtimes.js";
import { UpstreamUnavailableError } from "../src/domain/errors.js";

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

test("a runtime image missing from the host fails the recreate before the old container is touched", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  runtime.imageMissing = true;
  const manager = createManager(repo, runtime, adapter());

  await assert.rejects(manager.recreate(baseInstance.id, baseInstance.userId), UpstreamUnavailableError);

  assert.deepEqual(runtime.removedContainers, []);
  assert.deepEqual(runtime.createdContainers, []);
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

test("a migration failure keeps the old container and returns the bot to stopped", async () => {
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
  assert.equal(repo.instance.status, "stopped");
  assert.equal(repo.instance.errorMessage, "doctor exited 1");
});

test("a start failure after the new container exists leaves the bot stopped, not error", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  runtime.start = async () => {
    throw new Error("start refused");
  };
  const manager = createManager(repo, runtime, adapter());

  await assert.rejects(() => manager.recreate(baseInstance.id, baseInstance.userId), /start refused/);
  assert.equal(repo.instance.containerId, "container-2");
  assert.equal(repo.instance.status, "stopped");
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
  assert.match(binding?.relayToken ?? "", /^[0-9a-f]{64}$/);
});

test("recreate keeps an existing relay binding", async () => {
  const integrations = { relayToken: "existing" };
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

test("restart on the current image reseeds the workspace so guidance changes reach the tenant", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const seeded: string[] = [];
  const manager = createManager(repo, runtime, {
    ...adapter({}),
    seedWorkspace: async (containerId) => {
      seeded.push(containerId);
    },
  });

  await manager.restart(baseInstance.id, baseInstance.userId);

  assert.deepEqual(seeded, ["container-1"]);
  assert.deepEqual(runtime.restartedContainers, ["container-1"]);
  assert.deepEqual(runtime.removedContainers, []);
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

// The volume carries the live session with keys rotated since pairing; the DB copy would roll them back.
test("neither recreate, start nor restart writes the pairing-time whatsapp creds over the volume", async () => {
  const paired = { ...baseInstance, hasWhatsappCreds: true };
  const injected: string[] = [];
  const withSpy = () => ({
    ...adapter(),
    injectWhatsappSession: async (containerId: string) => {
      injected.push(containerId);
    },
  });

  await createManager(new FakeRepo({ ...paired }), new FakeRuntime(), withSpy()).recreate(paired.id, paired.userId);
  await createManager(new FakeRepo({ ...paired, status: "stopped" }), new FakeRuntime(), withSpy()).start(paired.id, paired.userId);
  await createManager(new FakeRepo({ ...paired }), new FakeRuntime(), withSpy()).restart(paired.id, paired.userId);

  assert.deepEqual(injected, []);
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

test("the new container carries the host's restart policy", async () => {
  for (const policy of ["unless-stopped", "no"] as const) {
    const runtime = new FakeRuntime();
    const manager = createManager(new FakeRepo({ ...baseInstance }), runtime, adapter(), {}, policy);

    await manager.recreate(baseInstance.id, baseInstance.userId);

    assert.deepEqual(runtime.createdPolicies, [policy]);
  }
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
    this.instance = { ...this.instance, status, errorMessage: options?.errorMessage ?? this.instance.errorMessage };
    return true;
  }

  // What the reconciler does to a row whose container is not running for too long.
  markStopped(): void {
    this.instance = { ...this.instance, status: "stopped" };
  }

  async updateContainerId(_id: string, containerId: string): Promise<void> {
    this.instance = { ...this.instance, containerId };
  }

}

class FakeRuntime {
  readonly stoppedContainers: string[] = [];
  readonly removedContainers: string[] = [];
  readonly createdContainers: string[] = [];
  readonly createdPolicies: RestartPolicy[] = [];
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

  async create(opts: ContainerCreateOptions): Promise<string> {
    this.createdContainers.push("container-2");
    this.createdPolicies.push(opts.restartPolicy);
    return "container-2";
  }

  async start(containerId: string): Promise<void> {
    this.startedContainers.push(containerId);
  }

  async containerState(containerId: string): Promise<ContainerState | null> {
    return containerId.startsWith("container-") && containerId !== "container-gone"
      ? { running: true, restarting: false, health: "healthy", startedAt: null }
      : null;
  }

  // Like Docker: the bot's name follows the newest container created under it; a removed one frees it.
  async findContainerByName(): Promise<string | null> {
    const named = [this.options.byName ?? "container-1", ...this.createdContainers];
    return named.reverse().find((id) => !this.removedContainers.includes(id)) ?? null;
  }

  imageMissing = false;

  async ensureImagePresent(): Promise<void> {
    if (this.imageMissing) throw new UpstreamUnavailableError("image", "img is not on this host");
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
    internalPort: 18789,
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
    exportVolume: async () => {
      throw new Error("not implemented");
    },
    importVolume: async () => {},
    probeGateway: async () => ({ healthy: true, degraded: null }),
    probeWhatsapp: async () => "unknown" as const,
    logoutWhatsapp: async () => ({ unlinked: true, cleared: true }),
    readOwnerIds: async () => [],
    closeBrowserTabs: async () => ({ closed: 0, failed: 0 }),
    listWhatsappPairingRequests: async () => [],
    startWhatsappChannel: async () => ({ status: "started" as const }),
    sendWhatsappMessage: async () => true,
    prepareState: async () => {},
    seedWorkspace: async () => {},
    isOnCurrentImage: async (containerId) => !stale.has(containerId),
    verify: async () => [],
  };
}

function createManager(
  repo: FakeRepo,
  runtime: FakeRuntime,
  adapterImpl: AgentRuntimeAdapter,
  config: Partial<AppConfig> = {},
  restartPolicy: RestartPolicy = "unless-stopped",
  extras: { moveStorage?: unknown; events?: { type: string; actor?: string }[] } = {},
): InstanceManager {
  const registry = {
    get: () => adapterImpl,
  } as unknown as AgentRuntimeRegistry;
  return new InstanceManager(
    repo as never,
    singleHost(runtime as unknown as ContainerRuntime, registry, undefined, { restartPolicy }),
    {} as never,
    { choose: () => "test-host" } as never,
    { maxProvisionRetries: 3, ...config } as AppConfig,
    {
      append: async (_id: string, type: string, opts?: { actor?: string }) => {
        extras.events?.push({ type, actor: opts?.actor });
      },
    } as never,
    {
      logoutWhatsapp: async () => {},
      teardownSidecar: async () => {},
    } as never,
    {
      revoke: async () => {},
      revokeKey: async () => {},
    } as never,
    fakeLogger,
    null,
    undefined,
    null,
    null,
    null,
    (extras.moveStorage ?? null) as never,
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
  movedFromHostId: null,
  moveObjectName: null,
  moveImportedAt: null,
  movedAt: null,
  stoppedAt: null,
  destroyedAt: null,
};

test("an operator's recreate needs no owner and is recorded as the system's, while the owner's route still checks ownership", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const events: { type: string; actor?: string }[] = [];
  const manager = createManager(repo, runtime, adapter(), {}, "unless-stopped", { events });

  await manager.recreateBySystem(baseInstance.id);

  assert.deepEqual(runtime.removedContainers, ["container-1"]);
  assert.equal(repo.instance.status, "running");
  assert.deepEqual(events.filter((e) => e.type === "instance.recreated"), [{ type: "instance.recreated", actor: undefined }]);
  await assert.rejects(manager.recreate(baseInstance.id, "someone-else"));
});

test("a rebuild onto another image snapshots the stopped volume to the bucket before the migration", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  const order: string[] = [];
  const events: { type: string; actor?: string }[] = [];
  const moveStorage = {
    uploadObjectStream: async (input: { objectName: string }) => {
      order.push(`snapshot:${input.objectName.split("/").slice(0, 2).join("/")}:stopped=${runtime.stoppedContainers.length}`);
      return { contentLength: 1024 };
    },
  };
  const manager = createManager(
    repo,
    runtime,
    {
      ...adapter({ staleImage: true }),
      exportVolume: async () => Readable.from(["tar"]),
      prepareState: async () => void order.push(`prepare:removed=${runtime.removedContainers.length}`),
    },
    {},
    "unless-stopped",
    { moveStorage, events },
  );

  await manager.recreateBySystem(baseInstance.id);

  assert.deepEqual(order, [`snapshot:snapshots/${baseInstance.id}:stopped=1`, "prepare:removed=0"]);
  assert.ok(events.some((e) => e.type === "instance.snapshot"));
});

test("no snapshot when the container is already on the current image or no bucket is configured", async () => {
  const uploads: string[] = [];
  const moveStorage = { uploadObjectStream: async (input: { objectName: string }) => (uploads.push(input.objectName), { contentLength: 1 }) };

  const onImage = createManager(new FakeRepo({ ...baseInstance }), new FakeRuntime(), adapter(), {}, "unless-stopped", { moveStorage });
  await onImage.recreateBySystem(baseInstance.id);

  const noBucket = createManager(new FakeRepo({ ...baseInstance }), new FakeRuntime(), adapter({ staleImage: true }));
  await noBucket.recreateBySystem(baseInstance.id);

  assert.deepEqual(uploads, []);
});

test("a snapshot that fails stops the rebuild before the migration: the old container stays, the bot is stopped", async () => {
  const repo = new FakeRepo({ ...baseInstance });
  const runtime = new FakeRuntime();
  let prepared = 0;
  const moveStorage = {
    uploadObjectStream: async () => {
      throw new Error("bucket unavailable");
    },
  };
  const manager = createManager(
    repo,
    runtime,
    { ...adapter({ staleImage: true }), exportVolume: async () => Readable.from(["tar"]), prepareState: async () => void (prepared += 1) },
    {},
    "unless-stopped",
    { moveStorage },
  );

  await assert.rejects(manager.recreateBySystem(baseInstance.id), /bucket unavailable/);

  assert.equal(prepared, 0);
  assert.deepEqual(runtime.removedContainers, []);
  assert.equal(repo.instance.status, "stopped");
});

test("verify reports the configured image and whether the bot is on it, and runs the runtime's checks on a running container", async () => {
  const check = { name: "plugins loaded", ok: true, detail: null };
  const fresh = createManager(new FakeRepo({ ...baseInstance }), new FakeRuntime(), { ...adapter(), verify: async () => [check] });
  assert.deepEqual(await fresh.verify(baseInstance.id), {
    status: "running",
    image: "openclaw-image",
    onCurrentImage: true,
    running: true,
    checks: [check],
  });

  const stale = createManager(new FakeRepo({ ...baseInstance }), new FakeRuntime(), { ...adapter({ staleImage: true }), verify: async () => [check] });
  assert.equal((await stale.verify(baseInstance.id)).onCurrentImage, false);
});

test("verify refuses a bot that is under an operation", async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const manager = createManager(new FakeRepo({ ...baseInstance }), new FakeRuntime(), { ...adapter(), prepareState: () => held });

  const rebuild = manager.recreateBySystem(baseInstance.id);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(manager.verify(baseInstance.id), /under an operation/);
  release();
  await rebuild;
});

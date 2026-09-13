import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InstanceManager } from "../src/services/instance-manager.js";
import type { ContainerRuntime, ContainerState } from "../src/services/container-runtime.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { AgentRuntimeAdapter } from "../src/services/agent-runtime/types.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const SETTLED: ContainerState = { running: true, restarting: false, health: "healthy", startedAt: null };

class FakeRepo {
  constructor(public instance: Instance) {}

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

  async updateContainerId(_id: string, containerId: string): Promise<void> {
    this.instance = { ...this.instance, containerId };
  }

  async getDecryptedWhatsappCreds(): Promise<Buffer | null> {
    return this.instance.hasWhatsappCreds ? Buffer.from("creds") : null;
  }
}

class FakeRuntime {
  readonly restartedContainers: string[] = [];
  readonly startedContainers: string[] = [];

  constructor(
    private readonly state: ContainerState | null = SETTLED,
    private readonly restartError: Error | null = null,
  ) {}

  async containerState(): Promise<ContainerState | null> {
    return this.state;
  }

  async inspect(containerId: string): Promise<{ Id: string } | null> {
    return { Id: containerId };
  }

  async findContainerByName(): Promise<string | null> {
    return null;
  }

  async waitForHealthy(): Promise<boolean> {
    return true;
  }

  restart = async (containerId: string): Promise<void> => {
    if (this.restartError) throw this.restartError;
    this.restartedContainers.push(containerId);
  };

  async start(containerId: string): Promise<void> {
    this.startedContainers.push(containerId);
  }
}

function harness(options: {
  instance?: Partial<Instance>;
  state?: ContainerState | null;
  gatewayLive?: boolean;
  restartError?: Error;
  onCurrentImage?: boolean;
} = {}) {
  const repo = new FakeRepo(makeInstance([{ type: "whatsapp" }], options.instance));
  const runtime = new FakeRuntime(options.state === undefined ? SETTLED : options.state, options.restartError ?? null);
  let probes = 0;
  const injected: string[] = [];
  const adapter = {
    kind: "openclaw",
    image: "openclaw-image",
    probeGateway: async () => {
      probes += 1;
      return { healthy: options.gatewayLive ?? false, degraded: null };
    },
    isOnCurrentImage: async () => options.onCurrentImage ?? true,
    writeConfig: async () => {},
    seedWorkspace: async () => {},
    injectWhatsappSession: async (containerId: string) => {
      injected.push(containerId);
    },
  } as unknown as AgentRuntimeAdapter;
  const registry = { get: () => adapter } as unknown as AgentRuntimeRegistry;
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
  const manager = new InstanceManager(
    repo as never,
    runtime as unknown as ContainerRuntime,
    registry,
    {} as never,
    { maxProvisionRetries: 3, healthRequestTimeoutMs: 1_000, useDockerNetwork: false } as AppConfig,
    { append: async () => {} } as never,
    {} as never,
    {} as never,
    logger,
  );
  return { manager, repo, runtime, probes: () => probes, injected };
}

test("restarts an unresponsive bot without re-injecting pairing-time credentials", async () => {
  const h = harness({ instance: { status: "unhealthy" } });

  const outcome = await h.manager.restartBySystem(h.repo.instance.id);

  assert.deepEqual(outcome, { restarted: true });
  assert.deepEqual(h.runtime.restartedContainers, ["container-1"]);
  assert.deepEqual(h.injected, []);
  assert.equal(h.repo.instance.status, "running");
});

test("leaves a bot alone when its gateway answers inside the lock", async () => {
  const h = harness({ gatewayLive: true });

  assert.deepEqual(await h.manager.restartBySystem(h.repo.instance.id), {
    restarted: false,
    reason: "gateway answered",
    transient: true,
  });
  assert.deepEqual(h.runtime.restartedContainers, []);
});

test("a bot with no container on record is a blocked restart, not a transient skip", async () => {
  const h = harness({ instance: { containerId: null } });

  assert.deepEqual(await h.manager.restartBySystem(h.repo.instance.id), {
    restarted: false,
    reason: "bot has no container on record",
    transient: false,
  });
  assert.equal(h.probes(), 0);
});

test("the reconciler can see a bot while a restart holds its lock", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness({ instance: { status: "unhealthy" } });
  h.runtime.restart = async (containerId: string) => {
    h.runtime.restartedContainers.push(containerId);
    await gate;
  };

  const restart = h.manager.restartBySystem(h.repo.instance.id);
  await Promise.resolve();
  assert.equal(h.manager.isOperating(h.repo.instance.id), true);
  assert.equal(h.manager.isOperating("someone-else"), false);

  release();
  await restart;
  assert.equal(h.manager.isOperating(h.repo.instance.id), false);
});

test("leaves a booting or freshly started container alone without probing it", async () => {
  const cases: ContainerState[] = [
    { ...SETTLED, health: "starting" },
    { ...SETTLED, restarting: true },
    { ...SETTLED, startedAt: new Date(Date.now() - 30_000) },
  ];
  for (const state of cases) {
    const h = harness({ state });
    assert.deepEqual(await h.manager.restartBySystem(h.repo.instance.id), {
      restarted: false,
      reason: "container is booting",
      transient: true,
    });
    assert.equal(h.probes(), 0);
    assert.deepEqual(h.runtime.restartedContainers, []);
  }
});

test("never migrates a container that is on another image", async () => {
  const h = harness({ onCurrentImage: false });

  const outcome = await h.manager.restartBySystem(h.repo.instance.id);

  assert.equal(outcome.restarted, false);
  assert.match(outcome.restarted ? "" : outcome.reason, /another image/);
  assert.equal(outcome.restarted ? null : outcome.transient, false);
  assert.equal(h.probes(), 0);
  assert.deepEqual(h.runtime.restartedContainers, []);
  assert.deepEqual(h.runtime.startedContainers, []);
});

test("leaves a stopped bot and a container Docker cannot find alone", async () => {
  const stopped = harness({ instance: { status: "stopped" } });
  assert.deepEqual(await stopped.manager.restartBySystem(stopped.repo.instance.id), {
    restarted: false,
    reason: "bot is stopped",
    transient: true,
  });
  assert.equal(stopped.probes(), 0);
  assert.equal(stopped.repo.instance.status, "stopped");

  const gone = harness({ state: null });
  assert.deepEqual(await gone.manager.restartBySystem(gone.repo.instance.id), {
    restarted: false,
    reason: "container is not running",
    transient: true,
  });
  assert.equal(gone.probes(), 0);
});

test("a failed system restart keeps the previous status instead of parking the bot in error", async () => {
  const h = harness({ instance: { status: "unhealthy" }, restartError: new Error("docker is away") });

  await assert.rejects(() => h.manager.restartBySystem(h.repo.instance.id), /docker is away/);

  assert.equal(h.repo.instance.status, "unhealthy");
  assert.equal(h.repo.instance.errorMessage, "docker is away");
});

test("a user restart still marks a failure as error", async () => {
  const h = harness({ restartError: new Error("docker is away") });

  await assert.rejects(
    () => h.manager.restart(h.repo.instance.id, h.repo.instance.userId),
    /docker is away/,
  );

  assert.equal(h.repo.instance.status, "error");
});

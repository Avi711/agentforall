import { test } from "node:test";
import assert from "node:assert/strict";
import type Docker from "dockerode";
import type { FastifyBaseLogger } from "fastify";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";
import type { ContainerCreateOptions, SidecarCreateOptions } from "../src/services/container-runtime.js";

interface Captured {
  HostConfig: { RestartPolicy: { Name: string; MaximumRetryCount?: number }; PortBindings?: Record<string, { HostIp: string; HostPort: string }[]> };
}

function capturing() {
  const created: Captured[] = [];
  const docker = {
    createContainer: async (payload: Captured) => {
      created.push(payload);
      return { id: "c-1", putArchive: async () => undefined };
    },
  } as unknown as Docker;
  return { runtime: new DockerContainerRuntime(docker, "tenant-net", {} as FastifyBaseLogger), created };
}

const bot = (overrides: Partial<ContainerCreateOptions>): ContainerCreateOptions => ({
  name: "openclaw-x",
  image: "img",
  internalPort: 18789,
  hostPort: 19042,
  healthPath: "/health",
  envVars: [],
  memoryBytes: 1,
  cpuShares: 1,
  labels: {},
  restartPolicy: "unless-stopped",
  bindIp: "127.0.0.1",
  ...overrides,
});

test("a bot beside the orchestrator restarts with Docker and binds its gateway to loopback", async () => {
  const { runtime, created } = capturing();
  await runtime.create(bot({}));
  assert.deepEqual(created[0]?.HostConfig.RestartPolicy, { Name: "unless-stopped", MaximumRetryCount: 0 });
  assert.deepEqual(created[0]?.HostConfig.PortBindings, { "18789/tcp": [{ HostIp: "127.0.0.1", HostPort: "19042" }] });
});

test("a bot on a worker never restarts on its own and binds its gateway to the worker's address", async () => {
  const { runtime, created } = capturing();
  await runtime.create(bot({ restartPolicy: "no", bindIp: "10.0.0.9" }));
  assert.deepEqual(created[0]?.HostConfig.RestartPolicy, { Name: "no", MaximumRetryCount: 0 });
  assert.deepEqual(created[0]?.HostConfig.PortBindings, { "18789/tcp": [{ HostIp: "10.0.0.9", HostPort: "19042" }] });
});

test("a sidecar publishes its port only where asked, on the given address", async () => {
  const { runtime, created } = capturing();
  const sidecar: SidecarCreateOptions = {
    name: "pairing-x",
    image: "img",
    envVars: [],
    memoryBytes: 1,
    cpuShares: 1,
    labels: {},
    volumeMounts: [],
  };
  await runtime.createSidecar(sidecar);
  await runtime.createSidecar({ ...sidecar, publish: { port: 18790, bindIp: "10.0.0.9" } });
  assert.equal(created[0]?.HostConfig.PortBindings, undefined);
  assert.deepEqual(created[1]?.HostConfig.PortBindings, { "18790/tcp": [{ HostIp: "10.0.0.9", HostPort: "" }] });
  assert.deepEqual(created[1]?.HostConfig.RestartPolicy, { Name: "no" });
});

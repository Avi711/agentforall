import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";
import { HostReachability } from "../src/services/host-reachability.js";
import { createRemoteHost, type RemoteHostDeps } from "../src/services/remote-host.js";

const logger = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

function deps(): RemoteHostDeps & { adaptersBuiltFor: ContainerRuntime[] } {
  const adaptersBuiltFor: ContainerRuntime[] = [];
  return {
    tls: { ca: Buffer.from("ca"), cert: Buffer.from("cert"), key: Buffer.from("key") },
    adaptersFor: (runtime) => {
      adaptersBuiltFor.push(runtime);
      return { get: () => undefined } as unknown as AgentRuntimeRegistry;
    },
    networkName: "tenant-net",
    logger,
    adaptersBuiltFor,
  };
}

test("a remote bundle is addressed, never auto-restarted, dialed by address, gated by reachability and carries the row's capacity", () => {
  const d = deps();
  const host = createRemoteHost("worker-1", "10.10.0.7", d, { capacityMb: 16_000, status: "draining" });
  assert.equal(host.hostId, "worker-1");
  assert.equal(host.address, "10.10.0.7");
  assert.equal(host.capacityMb, 16_000);
  assert.equal(host.status, "draining");
  assert.equal(host.restartPolicy, "no");
  assert.equal(host.dockerNetwork, false);
  assert.ok(host.runtime instanceof DockerContainerRuntime);
  assert.ok(host.gate instanceof HostReachability);
  assert.deepEqual(d.adaptersBuiltFor, [host.runtime]);
});

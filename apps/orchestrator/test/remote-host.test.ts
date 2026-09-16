import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";
import { HostReachability } from "../src/services/host-reachability.js";
import { StaticHostRuntimes, type HostCapacity, type HostRuntime } from "../src/services/host-runtimes.js";
import { createHostAttacher, createRemoteHost, createStubHost, type RemoteHostDeps } from "../src/services/remote-host.js";
import { UnknownHostError } from "../src/domain/errors.js";

const logger = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
const UNKNOWN: HostCapacity = { capacityMb: null, status: "active" };

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

function localHost(): HostRuntime {
  return {
    hostId: "agent-forall-vm",
    address: null,
    capacityMb: 32_089,
    status: "active",
    restartPolicy: "unless-stopped",
    dockerNetwork: true,
    runtime: {} as ContainerRuntime,
    adapters: {} as AgentRuntimeRegistry,
    gate: { check: async () => true },
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

test("a stub keeps its own capacity, its gate stays closed, and every Docker call on it is refused as an unknown host", async () => {
  const d = deps();
  const stub = createStubHost("worker-1", d, UNKNOWN);
  assert.equal(stub.hostId, "worker-1");
  assert.equal(stub.address, null);
  assert.equal(stub.capacityMb, null);
  assert.equal(stub.status, "active");
  assert.equal(stub.restartPolicy, "no");
  assert.equal(stub.dockerNetwork, false);
  assert.equal(await stub.gate.check(), false);
  assert.deepEqual(d.adaptersBuiltFor, [stub.runtime]);
  await assert.rejects(() => stub.runtime.findContainerByName("openclaw-x"), UnknownHostError);
  await assert.rejects(() => stub.runtime.removeVolume("oc-x-state"), UnknownHostError);
  // A logged or awaited stub must behave like a plain object, never like a promise.
  assert.equal(JSON.stringify({ runtime: stub.runtime }), '{"runtime":{}}');
  assert.equal(await Promise.resolve(stub.runtime), stub.runtime);
});

test("the attacher skips the local host, keeps a bundle whose address is unchanged, and replaces a stub or a moved worker", () => {
  const local = localHost();
  const attachDeps: RemoteHostDeps = {
    tls: { ca: Buffer.alloc(0), cert: Buffer.alloc(0), key: Buffer.alloc(0) },
    adaptersFor: () => ({}) as never,
    networkName: "tenant-net",
    logger,
  };
  const hosts = new StaticHostRuntimes([
    local,
    createStubHost("worker-1", attachDeps, UNKNOWN),
    createRemoteHost("worker-2", "10.10.0.8", attachDeps, { capacityMb: 8000, status: "draining" }),
  ]);
  const attach = createHostAttacher(hosts, "agent-forall-vm", attachDeps, logger);

  attach("agent-forall-vm", "10.10.0.2", 1);
  assert.equal(hosts.for("agent-forall-vm"), local);
  assert.equal(hosts.all().length, 3);

  const worker2 = hosts.for("worker-2");
  attach("worker-2", "10.10.0.8");
  assert.equal(hosts.for("worker-2"), worker2);

  const stub = hosts.for("worker-1");
  attach("worker-1", "10.10.0.7");
  const attached = hosts.for("worker-1");
  assert.notEqual(attached, stub);
  assert.equal(attached.address, "10.10.0.7");
  assert.equal(attached.capacityMb, null);
  assert.equal(attached.restartPolicy, "no");
  attach("worker-1", "10.10.0.7");
  assert.equal(hosts.for("worker-1"), attached);
});

test("the attacher records a reported capacity: on a new bundle, or onto the existing one without a new client", () => {
  const local = localHost();
  const attachDeps: RemoteHostDeps = {
    tls: { ca: Buffer.alloc(0), cert: Buffer.alloc(0), key: Buffer.alloc(0) },
    adaptersFor: () => ({}) as never,
    networkName: "tenant-net",
    logger,
  };
  const hosts = new StaticHostRuntimes([
    local,
    createStubHost("worker-1", attachDeps, UNKNOWN),
    createRemoteHost("worker-2", "10.10.0.8", attachDeps, { capacityMb: 8000, status: "draining" }),
  ]);
  const attach = createHostAttacher(hosts, "agent-forall-vm", attachDeps, logger);

  attach("worker-1", "10.10.0.7", 16_000);
  assert.equal(hosts.for("worker-1").capacityMb, 16_000);
  assert.equal(hosts.for("worker-1").status, "active");

  const worker2 = hosts.for("worker-2");
  attach("worker-2", "10.10.0.8", 12_000);
  const resized = hosts.for("worker-2");
  assert.notEqual(resized, worker2);
  assert.equal(resized.runtime, worker2.runtime, "same address keeps the same client");
  assert.equal(resized.capacityMb, 12_000);
  assert.equal(resized.status, "draining");

  attach("worker-2", "10.10.0.9");
  assert.equal(hosts.for("worker-2").capacityMb, 12_000, "a move without a figure keeps the last one");
  assert.equal(hosts.for("worker-2").status, "draining");
});

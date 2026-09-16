import type { FastifyBaseLogger } from "fastify";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import type { ContainerRuntime } from "./container-runtime.js";
import { DockerContainerRuntime, createDockerClient, type DockerTls } from "./docker-container-runtime.js";
import { HostReachability } from "./host-reachability.js";
import type { HostCapacity, HostRuntime, StaticHostRuntimes } from "./host-runtimes.js";
import { UnknownHostError } from "../domain/errors.js";

export interface RemoteHostDeps {
  tls: DockerTls;
  adaptersFor(runtime: ContainerRuntime): AgentRuntimeRegistry;
  networkName: string;
  logger: FastifyBaseLogger;
}

export function createRemoteHost(hostId: string, address: string, deps: RemoteHostDeps, capacity: HostCapacity): HostRuntime {
  const runtime = new DockerContainerRuntime(createDockerClient({ host: address, tls: deps.tls }), deps.networkName, deps.logger);
  return {
    hostId,
    address,
    capacityMb: capacity.capacityMb,
    status: capacity.status,
    restartPolicy: "no",
    dockerNetwork: false,
    runtime,
    adapters: deps.adaptersFor(runtime),
    gate: new HostReachability(hostId, runtime, deps.logger),
  };
}

// A managed worker that has not registered an address yet: visible to placement, every Docker call refused.
export function createStubHost(hostId: string, deps: Pick<RemoteHostDeps, "adaptersFor">, capacity: HostCapacity): HostRuntime {
  const runtime = unreachableRuntime(hostId);
  return {
    hostId,
    address: null,
    capacityMb: capacity.capacityMb,
    status: capacity.status,
    restartPolicy: "no",
    dockerNetwork: false,
    runtime,
    adapters: deps.adaptersFor(runtime),
    gate: { check: async () => false },
  };
}

// A path that skips the gate must never land on another host's daemon, so every method rejects.
function unreachableRuntime(hostId: string): ContainerRuntime {
  return new Proxy({} as ContainerRuntime, {
    // Serialisation and awaiting must see a plain object, or a log line on a stub takes the process down.
    get: (_target, prop) =>
      typeof prop !== "string" || prop === "then" || prop === "toJSON" || prop === "constructor"
        ? undefined
        : () => Promise.reject(new UnknownHostError(hostId)),
  });
}

// Same address again means the same client; only a stub or a moved worker gets a new runtime.
export function createHostAttacher(
  hosts: StaticHostRuntimes,
  localHostId: string,
  deps: RemoteHostDeps,
  logger: FastifyBaseLogger,
): (hostId: string, address: string, memoryMb?: number) => void {
  return (hostId, address, memoryMb) => {
    if (hostId === localHostId) return;
    const current = hosts.for(hostId);
    const capacityMb = memoryMb ?? current.capacityMb;
    if (current.address === address) {
      if (capacityMb !== current.capacityMb) hosts.upsert({ ...current, capacityMb });
      return;
    }
    hosts.upsert(createRemoteHost(hostId, address, deps, { capacityMb, status: current.status }));
    logger.info({ hostId, address, capacityMb }, "remote host attached");
  };
}

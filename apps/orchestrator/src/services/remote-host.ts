import type { FastifyBaseLogger } from "fastify";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import type { ContainerRuntime } from "./container-runtime.js";
import { DockerContainerRuntime, createDockerClient, type DockerTls } from "./docker-container-runtime.js";
import { HostReachability } from "./host-reachability.js";
import type { HostCapacity, HostRuntime } from "./host-runtimes.js";

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

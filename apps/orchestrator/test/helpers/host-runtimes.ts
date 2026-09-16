import type { AgentRuntimeRegistry } from "../../src/services/agent-runtime/registry.js";
import type { ContainerRuntime } from "../../src/services/container-runtime.js";
import type { HostGate } from "../../src/services/host-reachability.js";
import type { HostRuntime, HostRuntimes } from "../../src/services/host-runtimes.js";
import { UnknownHostError } from "../../src/domain/errors.js";

export interface HostSpec {
  hostId: string;
  runtime: ContainerRuntime;
  adapters: AgentRuntimeRegistry;
  gate?: HostGate;
  overrides?: Partial<Pick<HostRuntime, "address" | "restartPolicy" | "dockerNetwork" | "capacityMb" | "status">>;
}

// Two distinct hosts, each with its own runtime; unknown ids throw like the real registry.
export function twoHosts(a: HostSpec, b: HostSpec): HostRuntimes {
  const hosts = new Map([a, b].map((spec) => [spec.hostId, bundle(spec)]));
  return {
    for: (hostId) => {
      const host = hosts.get(hostId);
      if (!host) throw new UnknownHostError(hostId);
      return host;
    },
    all: () => [...hosts.values()],
  };
}

function bundle(spec: HostSpec): HostRuntime {
  return {
    hostId: spec.hostId,
    address: null,
    capacityMb: 32_089,
    status: "active",
    restartPolicy: "unless-stopped",
    dockerNetwork: true,
    runtime: spec.runtime,
    adapters: spec.adapters,
    gate: spec.gate ?? { check: async () => true },
    ...spec.overrides,
  };
}

// One bundle for every host id, so fixtures keep whatever hostId they carry. Defaults describe the local prod host.
export function singleHost(
  runtime: ContainerRuntime,
  adapters: AgentRuntimeRegistry,
  gate: HostGate = { check: async () => true },
  overrides: Partial<Pick<HostRuntime, "address" | "restartPolicy" | "dockerNetwork" | "capacityMb" | "status">> = {},
): HostRuntimes {
  const host: HostRuntime = {
    hostId: "test-host",
    address: null,
    capacityMb: 32_089,
    status: "active",
    restartPolicy: "unless-stopped",
    dockerNetwork: true,
    runtime,
    adapters,
    gate,
    ...overrides,
  };
  return { for: () => host, all: () => [host] };
}

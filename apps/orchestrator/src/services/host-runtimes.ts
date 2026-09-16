import { UnknownHostError } from "../domain/errors.js";
import type { HostStatus, Instance } from "../domain/types.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import type { ContainerRuntime, RestartPolicy } from "./container-runtime.js";
import type { HostGate } from "./host-reachability.js";

export interface HostCapacity {
  // Total RAM in MB; null until the host reports it, which keeps it out of placement.
  capacityMb: number | null;
  status: HostStatus;
}

export interface HostRuntime extends HostCapacity {
  hostId: string;
  // null = this host, reached over the Docker network; a worker is dialed by its private IP.
  address: string | null;
  // Remote hosts get "no": a rebooted worker never runs bots the orchestrator did not start; the reconciler re-adopts them.
  restartPolicy: RestartPolicy;
  // Local only: false when the orchestrator runs outside Docker (dev) and dials published ports on 127.0.0.1.
  dockerNetwork: boolean;
  runtime: ContainerRuntime;
  adapters: AgentRuntimeRegistry;
  gate: HostGate;
}

export interface HostRuntimes {
  for(hostId: string): HostRuntime;
  all(): readonly HostRuntime[];
}

export class StaticHostRuntimes implements HostRuntimes {
  private readonly byId: Map<string, HostRuntime>;

  constructor(hosts: readonly HostRuntime[]) {
    this.byId = new Map(hosts.map((host) => [host.hostId, host]));
    if (this.byId.size !== hosts.length) throw new Error("duplicate host id");
  }

  for(hostId: string): HostRuntime {
    const host = this.byId.get(hostId);
    if (!host) throw new UnknownHostError(hostId);
    return host;
  }

  all(): readonly HostRuntime[] {
    return [...this.byId.values()];
  }

  upsert(host: HostRuntime): void {
    this.byId.set(host.hostId, host);
  }

  setCapacity(hostId: string, capacityMb: number): void {
    this.byId.set(hostId, { ...this.for(hostId), capacityMb });
  }
}

export function dialUrl(
  host: Pick<HostRuntime, "address" | "dockerNetwork">,
  instance: Pick<Instance, "containerName" | "gatewayPort">,
  internalPort: number,
): string {
  if (host.address !== null) return `http://${host.address}:${instance.gatewayPort}`;
  if (host.dockerNetwork) return `http://${instance.containerName}:${internalPort}`;
  return `http://127.0.0.1:${instance.gatewayPort}`;
}

export function groupByHost<T extends { hostId: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.hostId);
    if (group) group.push(item);
    else groups.set(item.hostId, [item]);
  }
  return groups;
}

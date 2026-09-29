import type { InstanceRepository } from "../storage/instance-repository.js";
import { PortExhaustedError } from "../domain/errors.js";

export class PortAllocator {
  readonly capacity: number;
  private readonly pendingByHost = new Map<string, Set<number>>();

  constructor(
    private readonly repo: InstanceRepository,
    private readonly rangeStart: number,
    private readonly rangeEnd: number,
  ) {
    this.capacity = rangeEnd - rangeStart + 1;
  }

  // Held until its row is saved; ports held when the read began stay excluded, as one released meanwhile may be missing from it.
  async allocate(hostId: string): Promise<number> {
    const pending = this.pendingFor(hostId);
    const heldBeforeRead = new Set(pending);
    const usedPorts = new Set(await this.repo.getActiveGatewayPorts(hostId));

    for (let port = this.rangeStart; port <= this.rangeEnd; port++) {
      if (!usedPorts.has(port) && !pending.has(port) && !heldBeforeRead.has(port)) {
        pending.add(port);
        return port;
      }
    }

    throw new PortExhaustedError(this.rangeStart, this.rangeEnd);
  }

  release(hostId: string, port: number): void {
    this.pendingByHost.get(hostId)?.delete(port);
  }

  private pendingFor(hostId: string): Set<number> {
    let pending = this.pendingByHost.get(hostId);
    if (!pending) {
      pending = new Set();
      this.pendingByHost.set(hostId, pending);
    }
    return pending;
  }
}

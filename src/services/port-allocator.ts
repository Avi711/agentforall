import type { InstanceRepository } from "../storage/instance-repository.js";
import { PortExhaustedError } from "../domain/errors.js";

export class PortAllocator {
  readonly capacity: number;

  constructor(
    private readonly repo: InstanceRepository,
    private readonly rangeStart: number,
    private readonly rangeEnd: number,
  ) {
    this.capacity = rangeEnd - rangeStart + 1;
  }

  async allocate(): Promise<number> {
    const usedPorts = new Set(await this.repo.getActiveGatewayPorts());

    for (let port = this.rangeStart; port <= this.rangeEnd; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new PortExhaustedError(this.rangeStart, this.rangeEnd);
  }
}

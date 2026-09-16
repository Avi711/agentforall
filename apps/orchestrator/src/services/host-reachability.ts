import type { FastifyBaseLogger } from "fastify";
import type { ContainerRuntime } from "./container-runtime.js";

export interface HostGate {
  check(): Promise<boolean>;
}

// One slow answer under load is not an outage; two in a row is. One answer closes the breaker again.
const OPEN_AFTER_MISSES = 2;

// Callers skip Docker-facing work on a host that does not answer, so an outage never reads as every bot failing.
export class HostReachability implements HostGate {
  private reachable = true;
  private misses = 0;
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly hostId: string,
    private readonly runtime: ContainerRuntime,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Concurrent callers share one ping, so a transition is decided and logged once.
  check(): Promise<boolean> {
    this.inFlight ??= this.probe().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async probe(): Promise<boolean> {
    let error: unknown = null;
    try {
      await this.runtime.ping();
      this.misses = 0;
    } catch (err) {
      error = err;
      this.misses += 1;
    }
    const reachable = error === null || (this.reachable && this.misses < OPEN_AFTER_MISSES);
    if (!reachable && this.reachable) this.logger.warn({ hostId: this.hostId, err: error }, "host unreachable");
    if (reachable && !this.reachable) this.logger.info({ hostId: this.hostId }, "host reachable again");
    this.reachable = reachable;
    return reachable;
  }
}

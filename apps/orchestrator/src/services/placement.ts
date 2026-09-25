import type { FastifyBaseLogger } from "fastify";
import { NoPlacementError } from "../domain/errors.js";
import type { HostRuntime, HostRuntimes } from "./host-runtimes.js";

export interface HostUsage {
  usedMb(hostId: string): number;
  measured(instanceId: string): boolean;
}

export interface PlacementConfig {
  overcommit: number;
  reserveMb: number;
}

// Never fill a host past this share of what is left after the reserve.
const USABLE_FRACTION = 0.9;
const RESERVATION_TTL_MS = 30 * 60_000;

interface Reservation {
  hostId: string;
  mb: number;
  atMs: number;
}

interface Verdict {
  hostId: string;
  headroomMb: number | null;
  skipped: string | null;
}

export class Placement {
  private readonly reservations = new Map<string, Reservation>();

  constructor(
    private readonly hosts: HostRuntimes,
    private readonly usage: HostUsage,
    private readonly config: PlacementConfig,
    private readonly logger: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  async choose(memoryMb: number, instanceId: string): Promise<string> {
    const hosts = this.hosts.all();
    const reachable = await Promise.all(hosts.map((host) => (this.eligible(host) ? host.gate.check() : false)));
    // Nothing awaits from here to the reservation, so concurrent choices see each other.
    const verdicts = hosts.map((host, i) =>
      host.status === "active" ? this.verdict(host, memoryMb, reachable[i] === true) : this.skip(host, host.status),
    );
    const best = verdicts
      .filter((v) => v.headroomMb !== null && v.headroomMb >= 0)
      .sort((a, b) => (b.headroomMb ?? 0) - (a.headroomMb ?? 0))[0];
    if (!best) {
      this.logger.warn({ memoryMb, hosts: verdicts }, "no host has room for a new bot");
      throw new NoPlacementError();
    }
    this.reservations.set(instanceId, { hostId: best.hostId, mb: this.counted(memoryMb), atMs: this.now() });
    this.logger.info({ hostId: best.hostId, headroomMb: best.headroomMb, memoryMb }, "bot placed");
    return best.hostId;
  }

  release(instanceId: string): void {
    this.reservations.delete(instanceId);
  }

  // For a host the caller already picked (a move target): draining keeps new bots away, an operator's move still lands.
  async assertFits(hostId: string, memoryMb: number): Promise<void> {
    const host = this.hosts.for(hostId);
    const reachable = host.capacityMb !== null && (await host.gate.check());
    const verdict = this.verdict(host, memoryMb, reachable);
    if (verdict.headroomMb === null || verdict.headroomMb < 0) {
      this.logger.warn({ memoryMb, host: verdict }, "host has no room for the bot");
      throw new NoPlacementError();
    }
  }

  private eligible(host: HostRuntime): boolean {
    return host.status === "active" && host.capacityMb !== null;
  }

  private skip(host: HostRuntime, reason: string): Verdict {
    return { hostId: host.hostId, headroomMb: null, skipped: reason };
  }

  private verdict(host: HostRuntime, memoryMb: number, reachable: boolean): Verdict {
    if (host.capacityMb === null) return this.skip(host, "capacity unknown");
    if (!reachable) return this.skip(host, "unreachable");
    const budgetMb = USABLE_FRACTION * (host.capacityMb - this.config.reserveMb);
    const usedMb = this.usage.usedMb(host.hostId) + this.pendingMb(host.hostId);
    return { hostId: host.hostId, headroomMb: Math.floor(budgetMb - usedMb - this.counted(memoryMb)), skipped: null };
  }

  private counted(memoryMb: number): number {
    return memoryMb / this.config.overcommit;
  }

  private pendingMb(hostId: string): number {
    const cutoff = this.now() - RESERVATION_TTL_MS;
    let total = 0;
    for (const [instanceId, reservation] of this.reservations) {
      if (reservation.atMs < cutoff || this.usage.measured(instanceId)) {
        this.reservations.delete(instanceId);
      } else if (reservation.hostId === hostId) {
        total += reservation.mb;
      }
    }
    return total;
  }
}

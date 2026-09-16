import type { FastifyBaseLogger } from "fastify";
import { NoPlacementError } from "../domain/errors.js";
import type { HostRuntime, HostRuntimes } from "./host-runtimes.js";

export interface HostUsage {
  usedMb(hostId: string): number;
}

export interface PlacementConfig {
  overcommit: number;
  reserveMb: number;
}

// Never fill a host past this share of what is left after the reserve.
const USABLE_FRACTION = 0.9;

interface Verdict {
  hostId: string;
  headroomMb: number | null;
  skipped: string | null;
}

export class Placement {
  constructor(
    private readonly hosts: HostRuntimes,
    private readonly usage: HostUsage,
    private readonly config: PlacementConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async choose(memoryMb: number): Promise<string> {
    const verdicts = await Promise.all(this.hosts.all().map((host) => this.assess(host, memoryMb)));
    const best = verdicts
      .filter((v) => v.headroomMb !== null && v.headroomMb >= 0)
      .sort((a, b) => (b.headroomMb ?? 0) - (a.headroomMb ?? 0))[0];
    if (!best) {
      this.logger.warn({ memoryMb, hosts: verdicts }, "no host has room for a new bot");
      throw new NoPlacementError();
    }
    this.logger.info({ hostId: best.hostId, headroomMb: best.headroomMb, memoryMb }, "bot placed");
    return best.hostId;
  }

  // For a host the caller already picked (a move target): draining keeps new bots away, an operator's move still lands.
  async assertFits(hostId: string, memoryMb: number): Promise<void> {
    const verdict = await this.headroom(this.hosts.for(hostId), memoryMb);
    if (verdict.headroomMb === null || verdict.headroomMb < 0) {
      this.logger.warn({ memoryMb, host: verdict }, "host has no room for the bot");
      throw new NoPlacementError();
    }
  }

  private async assess(host: HostRuntime, memoryMb: number): Promise<Verdict> {
    if (host.status !== "active") return { hostId: host.hostId, headroomMb: null, skipped: host.status };
    return this.headroom(host, memoryMb);
  }

  private async headroom(host: HostRuntime, memoryMb: number): Promise<Verdict> {
    const verdict = { hostId: host.hostId, headroomMb: null, skipped: null };
    if (host.capacityMb === null) return { ...verdict, skipped: "capacity unknown" };
    if (!(await host.gate.check())) return { ...verdict, skipped: "unreachable" };
    const budgetMb = USABLE_FRACTION * (host.capacityMb - this.config.reserveMb);
    const headroomMb = Math.floor(budgetMb - this.usage.usedMb(host.hostId) - memoryMb / this.config.overcommit);
    return { ...verdict, headroomMb };
  }
}

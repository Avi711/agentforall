import type { FastifyBaseLogger } from "fastify";
import type { FleetInstance, InstanceStatus } from "../domain/types.js";
import type { ContainerMemory, ContainerRuntime } from "./container-runtime.js";
import { mapWithConcurrency } from "./concurrency.js";
import { groupByHost, type HostRuntimes } from "./host-runtimes.js";
import type { HostUsage } from "./placement.js";

export interface MemoryWatchConfig {
  intervalMs: number;
  warnFraction: number;
}

export interface RunningInstances {
  findByStatuses(statuses: InstanceStatus[]): Promise<FleetInstance[]>;
}

const STATS_CONCURRENCY = 4;
const MB = 1024 * 1024;

// Logs on the way up and on the way down, never every tick, so the log-based alert fires once per episode.
export class MemoryWatch implements HostUsage {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentSweep: Promise<void> | null = null;
  private readonly high = new Set<string>();
  private readonly usedByHost = new Map<string, number>();

  constructor(
    private readonly repo: RunningInstances,
    private readonly hosts: HostRuntimes,
    private readonly logger: FastifyBaseLogger,
    private readonly config: MemoryWatchConfig,
  ) {}

  start(): void {
    if (this.intervalHandle) return;
    this.logger.info(
      { intervalMs: this.config.intervalMs, warnFraction: this.config.warnFraction },
      "memory watch started",
    );
    void this.sweep();
    this.intervalHandle = setInterval(() => void this.sweep(), this.config.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.currentSweep;
  }

  // Σ of the last sweep's container usage on the host; 0 before the first sweep or when the host runs no bot.
  usedMb(hostId: string): number {
    return this.usedByHost.get(hostId) ?? 0;
  }

  async sweep(): Promise<void> {
    if (this.currentSweep) return;
    this.currentSweep = this.runSweep();
    try {
      await this.currentSweep;
    } finally {
      this.currentSweep = null;
    }
  }

  private async runSweep(): Promise<void> {
    try {
      const active = await this.repo.findByStatuses(["running", "degraded", "unhealthy"]);
      const seen = new Set(active.map((inst) => inst.id));
      const groups = groupByHost(active);
      await Promise.all([...groups].map(([hostId, group]) => this.sweepHost(hostId, group)));
      for (const id of this.high) {
        if (!seen.has(id)) this.high.delete(id);
      }
      for (const hostId of this.usedByHost.keys()) {
        if (!groups.has(hostId)) this.usedByHost.delete(hostId);
      }
    } catch (err) {
      this.logger.error({ err }, "memory watch sweep failed");
    }
  }

  // An unreachable host keeps its last figure: stale beats a zero that placement would read as empty.
  private async sweepHost(hostId: string, group: readonly FleetInstance[]): Promise<void> {
    const host = this.hosts.for(hostId);
    if (!(await host.gate.check())) return;
    const results = await mapWithConcurrency(group, STATS_CONCURRENCY, (inst) => this.check(inst, host.runtime));
    const usedBytes = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value : 0), 0);
    this.usedByHost.set(hostId, Math.round(usedBytes / MB));
  }

  private async check(inst: FleetInstance, runtime: ContainerRuntime): Promise<number> {
    if (!inst.containerId) return 0;
    let memory: ContainerMemory | null;
    try {
      memory = await runtime.memoryUsage(inst.containerId);
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "memory stats unavailable");
      return 0;
    }
    if (!memory) return 0;
    if (memory.limitBytes <= 0) return memory.usedBytes;

    const fraction = memory.usedBytes / memory.limitBytes;
    const usedMb = Math.round(memory.usedBytes / MB);
    const limitMb = Math.round(memory.limitBytes / MB);
    const wasHigh = this.high.has(inst.id);

    if (fraction >= this.config.warnFraction && !wasHigh) {
      this.high.add(inst.id);
      this.logger.warn({ instanceId: inst.id, usedMb, limitMb }, "bot memory high");
    } else if (fraction < this.config.warnFraction && wasHigh) {
      this.high.delete(inst.id);
      this.logger.info({ instanceId: inst.id, usedMb, limitMb }, "bot memory back to normal");
    }
    return memory.usedBytes;
  }
}

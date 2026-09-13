import type { FastifyBaseLogger } from "fastify";
import type { Instance, InstanceStatus } from "../domain/types.js";
import type { ContainerMemory } from "./container-runtime.js";
import { mapWithConcurrency } from "./concurrency.js";

export interface MemoryWatchConfig {
  intervalMs: number;
  warnFraction: number;
}

export interface MemoryReader {
  memoryUsage(containerId: string): Promise<ContainerMemory | null>;
}

export interface RunningInstances {
  findByStatuses(statuses: InstanceStatus[]): Promise<Instance[]>;
}

const STATS_CONCURRENCY = 4;

// Logs on the way up and on the way down, never every tick, so the log-based alert fires once per episode.
export class MemoryWatch {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentSweep: Promise<void> | null = null;
  private readonly high = new Set<string>();

  constructor(
    private readonly repo: RunningInstances,
    private readonly runtime: MemoryReader,
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
      await mapWithConcurrency(active, STATS_CONCURRENCY, (inst) => this.check(inst));
      for (const id of this.high) {
        if (!seen.has(id)) this.high.delete(id);
      }
    } catch (err) {
      this.logger.error({ err }, "memory watch sweep failed");
    }
  }

  private async check(inst: Instance): Promise<void> {
    if (!inst.containerId) return;
    let memory: ContainerMemory | null;
    try {
      memory = await this.runtime.memoryUsage(inst.containerId);
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "memory stats unavailable");
      return;
    }
    if (!memory || memory.limitBytes <= 0) return;

    const fraction = memory.usedBytes / memory.limitBytes;
    const usedMb = Math.round(memory.usedBytes / (1024 * 1024));
    const limitMb = Math.round(memory.limitBytes / (1024 * 1024));
    const wasHigh = this.high.has(inst.id);

    if (fraction >= this.config.warnFraction && !wasHigh) {
      this.high.add(inst.id);
      this.logger.warn({ instanceId: inst.id, usedMb, limitMb }, "bot memory high");
    } else if (fraction < this.config.warnFraction && wasHigh) {
      this.high.delete(inst.id);
      this.logger.info({ instanceId: inst.id, usedMb, limitMb }, "bot memory back to normal");
    }
  }
}

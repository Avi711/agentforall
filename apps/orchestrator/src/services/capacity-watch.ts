import type { FastifyBaseLogger } from "fastify";
import { BackgroundTasks } from "./background-tasks.js";
import type { FleetCapacity } from "./placement.js";

export interface CapacitySource {
  capacity(memoryMb: number): Promise<FleetCapacity>;
}

export interface CapacityWatchConfig {
  warnBots: number;
  memoryMb: number;
}

const REPEAT_WARNING_MS = 6 * 60 * 60_000;
const RECOVERY_MARGIN_BOTS = 5;

export class CapacityWatch {
  private lastLowWarningAt: number | null = null;
  private evaluating = false;
  private readonly tasks: BackgroundTasks;

  constructor(
    private readonly placement: CapacitySource,
    private readonly logger: FastifyBaseLogger,
    private readonly config: CapacityWatchConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.tasks = new BackgroundTasks(logger, "fleet capacity task failed unexpectedly");
  }

  swept(): void {
    this.tasks.launch(this.evaluate());
  }

  settle(timeoutMs?: number): Promise<void> {
    return this.tasks.settle(timeoutMs);
  }

  async evaluate(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;
    try {
      const { room, hosts } = await this.placement.capacity(this.config.memoryMb);
      if (room < this.config.warnBots) {
        const now = this.now();
        if (this.lastLowWarningAt === null || now - this.lastLowWarningAt >= REPEAT_WARNING_MS) {
          this.logger.warn({ room, warnBots: this.config.warnBots, hosts }, "fleet capacity low");
          this.lastLowWarningAt = now;
        }
      } else if (this.lastLowWarningAt !== null && room >= this.config.warnBots + RECOVERY_MARGIN_BOTS) {
        this.logger.info({ room, hosts }, "fleet capacity restored");
        this.lastLowWarningAt = null;
      }
    } catch (err) {
      this.logger.warn({ err }, "fleet capacity check failed");
    } finally {
      this.evaluating = false;
    }
  }
}

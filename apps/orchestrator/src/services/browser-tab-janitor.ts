import type { FastifyBaseLogger } from "fastify";
import type { FleetInstance } from "../domain/types.js";
import { TENANT_TIMEZONE } from "../domain/tenant.js";
import type { BrowserTabsClosed } from "./agent-runtime/types.js";
import { BackgroundTasks, type InstanceEventLog } from "./background-tasks.js";
import { mapWithConcurrency } from "./concurrency.js";
import { groupByHost, type HostRuntimes } from "./host-runtimes.js";
import type { MemoryHighObserver, RunningInstances } from "./memory-watch.js";

const NIGHTLY_HOUR = 4;
const CHECK_INTERVAL_MS = 5 * 60_000;
const PER_HOST_CONCURRENCY = 2;
const MEMORY_ATTEMPTS_PER_EPISODE = 3;

interface MemoryEpisode {
  attempts: number;
  done: boolean;
}

const localClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: TENANT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function nightlyRunDate(at: Date): string | null {
  const parts = Object.fromEntries(localClock.formatToParts(at).map((part) => [part.type, part.value]));
  if (Number(parts.hour) !== NIGHTLY_HOUR) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export class BrowserTabJanitor implements MemoryHighObserver {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastNightlyDate: string | null = null;
  private nightlyRunning = false;
  private readonly busy = new Set<string>();
  private readonly memoryEpisodes = new Map<string, MemoryEpisode>();
  private readonly tasks: BackgroundTasks;

  constructor(
    private readonly repo: RunningInstances,
    private readonly hosts: HostRuntimes,
    private readonly events: InstanceEventLog,
    private readonly logger: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.tasks = new BackgroundTasks(logger, "browser tab cleanup task failed unexpectedly");
  }

  start(): void {
    if (this.intervalHandle) return;
    this.tick();
    this.intervalHandle = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
  }

  async stop(timeoutMs: number): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.settle(timeoutMs);
  }

  settle(timeoutMs?: number): Promise<void> {
    return this.tasks.settle(timeoutMs);
  }

  tick(): void {
    const date = nightlyRunDate(new Date(this.now()));
    if (!date || date === this.lastNightlyDate || this.nightlyRunning) return;
    this.tasks.launch(this.runNightly(date));
  }

  memoryHigh(instance: FleetInstance, usedMb: number, limitMb: number): void {
    const episode = this.memoryEpisodes.get(instance.id) ?? { attempts: 0, done: false };
    if (episode.done || episode.attempts >= MEMORY_ATTEMPTS_PER_EPISODE || this.busy.has(instance.id)) return;
    episode.attempts += 1;
    this.memoryEpisodes.set(instance.id, episode);
    this.tasks.launch(
      this.closeTabs(instance, "memory", { usedMb, limitMb }).then((result) => {
        if (result) episode.done = true;
      }),
    );
  }

  memoryNormal(instanceId: string): void {
    this.memoryEpisodes.delete(instanceId);
  }

  async sweepFleet(): Promise<void> {
    const active = await this.repo.findByStatuses(["running", "degraded", "unhealthy"]);
    const totals = { bots: 0, closed: 0, failed: 0 };
    await Promise.all(
      [...groupByHost(active)].map(async ([hostId, group]) => {
        try {
          if (!(await this.hosts.for(hostId).gate.check())) return;
          await mapWithConcurrency(group, PER_HOST_CONCURRENCY, async (inst) => {
            const result = await this.closeTabs(inst, "nightly");
            if (!result) return;
            totals.bots += 1;
            totals.closed += result.closed;
            totals.failed += result.failed;
          });
        } catch (err) {
          this.logger.warn({ hostId, err }, "browser tab cleanup failed");
        }
      }),
    );
    this.logger.info(totals, "nightly browser tab cleanup");
  }

  private async runNightly(date: string): Promise<void> {
    this.nightlyRunning = true;
    try {
      await this.sweepFleet();
      this.lastNightlyDate = date;
    } finally {
      this.nightlyRunning = false;
    }
  }

  private async closeTabs(
    inst: FleetInstance,
    reason: "nightly" | "memory",
    memory?: { usedMb: number; limitMb: number },
  ): Promise<BrowserTabsClosed | null> {
    if (!inst.containerId || this.busy.has(inst.id)) return null;
    this.busy.add(inst.id);
    try {
      const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);
      const result = await adapter.closeBrowserTabs(inst.containerId);
      if (result.closed > 0 || result.failed > 0) {
        this.logger.info({ instanceId: inst.id, reason, ...result, ...memory }, "browser tabs closed");
      }
      if (reason === "memory" && result.closed > 0) {
        await this.events
          .append(inst.id, "instance.browser_tabs_closed", { payload: { ...result, ...memory } })
          .catch((err: unknown) => this.logger.warn({ instanceId: inst.id, err }, "browser tab cleanup not recorded"));
      }
      return result;
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, reason, err }, "browser tab cleanup failed");
      return null;
    } finally {
      this.busy.delete(inst.id);
    }
  }
}

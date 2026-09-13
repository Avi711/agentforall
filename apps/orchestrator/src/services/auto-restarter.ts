import type { FastifyBaseLogger } from "fastify";
import type { Instance } from "../domain/types.js";
import { errorMessage } from "../domain/errors.js";
import type { LivenessObserver, LivenessReport, LivenessSample } from "./health-monitor.js";

export interface AutoRestartConfig {
  failureThreshold: number;
  cooldownMs: number;
  maxRestartsPerWindow: number;
  windowMs: number;
}

// A transient skip clears on its own (bot answered, container booting); a blocked one needs a deploy or a human.
export type SystemRestartOutcome =
  | { restarted: true }
  | { restarted: false; reason: string; transient: boolean };

export interface SystemRestarter {
  restartBySystem(id: string): Promise<SystemRestartOutcome>;
}

export interface RestartEventLog {
  append(
    instanceId: string,
    eventType: string,
    opts?: { actor?: string; payload?: Record<string, unknown> },
  ): Promise<void>;
}

export const AUTO_RESTART_EVENTS = {
  restarted: "instance.auto_restarted",
  failed: "instance.auto_restart_failed",
  blocked: "instance.auto_restart_blocked",
  exhausted: "instance.auto_restart_exhausted",
} as const;

const FLEET_OUTAGE_MIN_DOWN = 3;

interface BotState {
  consecutiveFailures: number;
  restartsAt: number[];
  restarting: boolean;
  exhaustedNotified: boolean;
}

// The per-window budget exists so a bot that dies on every boot cannot be restarted forever.
export class AutoRestarter implements LivenessObserver {
  private readonly bots = new Map<string, BotState>();
  private readonly inFlight = new Set<Promise<void>>();
  private fleetOutage = false;

  constructor(
    private readonly manager: SystemRestarter,
    private readonly events: RestartEventLog,
    private readonly logger: FastifyBaseLogger,
    private readonly config: AutoRestartConfig,
    private readonly now: () => number = Date.now,
  ) {}

  observe(report: readonly LivenessReport[]): void {
    this.prune(new Set(report.map((entry) => entry.instance.id)));
    if (this.detectFleetOutage(report)) return;
    for (const { instance, sample } of report) this.track(instance, sample);
  }

  async settle(timeoutMs = Number.POSITIVE_INFINITY): Promise<void> {
    const all = Promise.all([...this.inFlight]).then(() => undefined);
    if (!Number.isFinite(timeoutMs)) return all;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([all, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Most bots failing in the same poll points at Docker, the network or the orchestrator, not at the bots.
  private detectFleetOutage(report: readonly LivenessReport[]): boolean {
    const down = report.filter((entry) => entry.sample === "down").length;
    const outage = down >= FLEET_OUTAGE_MIN_DOWN && down * 2 > report.length;
    if (outage && !this.fleetOutage) {
      this.logger.error({ down, total: report.length }, "most bots failed liveness at once; auto restart suspended");
    } else if (!outage && this.fleetOutage) {
      this.logger.info("fleet liveness recovered; auto restart resumed");
    }
    this.fleetOutage = outage;
    return outage;
  }

  private track(inst: Instance, sample: LivenessSample): void {
    const state = this.stateFor(inst.id);
    if (sample === "booting" || sample === "unknown" || state.restarting) return;
    if (sample === "live") {
      state.consecutiveFailures = 0;
      return;
    }

    state.consecutiveFailures += 1;
    if (state.consecutiveFailures < this.config.failureThreshold) return;

    const now = this.now();
    const last = state.restartsAt.at(-1);
    if (last !== undefined && now - last < this.config.cooldownMs) return;
    state.restartsAt = state.restartsAt.filter((at) => now - at < this.config.windowMs);
    if (state.restartsAt.length >= this.config.maxRestartsPerWindow) {
      this.launch(this.notifyExhausted(inst, state));
      return;
    }

    state.exhaustedNotified = false;
    this.launch(this.restart(inst, state, now));
  }

  // Tasks catch their own errors; the guard keeps a future slip from turning settle() into a throw at shutdown.
  private launch(task: Promise<void>): void {
    const guarded = task.catch((err: unknown) => {
      this.logger.error({ err }, "auto restart task failed unexpectedly");
    });
    this.inFlight.add(guarded);
    void guarded.finally(() => this.inFlight.delete(guarded));
  }

  private async restart(inst: Instance, state: BotState, now: number): Promise<void> {
    const payload = {
      consecutiveFailures: state.consecutiveFailures,
      restartsInWindow: state.restartsAt.length + 1,
    };
    state.restarting = true;
    try {
      this.logger.warn({ instanceId: inst.id, ...payload }, "gateway unresponsive; restarting bot");
      const outcome = await this.manager.restartBySystem(inst.id);
      if (outcome.restarted) {
        state.restartsAt.push(now);
        await this.record(inst.id, AUTO_RESTART_EVENTS.restarted, payload);
      } else if (outcome.transient) {
        this.logger.info({ instanceId: inst.id, reason: outcome.reason }, "auto restart skipped");
      } else {
        // Spends budget like a failure: a bot the system cannot restart must reach the exhausted alert, not loop quietly.
        state.restartsAt.push(now);
        this.logger.warn({ instanceId: inst.id, reason: outcome.reason }, "auto restart blocked");
        await this.record(inst.id, AUTO_RESTART_EVENTS.blocked, { ...payload, reason: outcome.reason });
      }
    } catch (err) {
      state.restartsAt.push(now);
      this.logger.error({ instanceId: inst.id, err }, "auto restart failed");
      await this.record(inst.id, AUTO_RESTART_EVENTS.failed, { ...payload, error: errorMessage(err) });
    } finally {
      state.restarting = false;
      state.consecutiveFailures = 0;
    }
  }

  private async notifyExhausted(inst: Instance, state: BotState): Promise<void> {
    if (state.exhaustedNotified) return;
    state.exhaustedNotified = true;
    const payload = { restartsInWindow: state.restartsAt.length, windowMs: this.config.windowMs };
    this.logger.error(
      { instanceId: inst.id, ...payload },
      "auto restart budget exhausted; bot needs manual attention",
    );
    await this.record(inst.id, AUTO_RESTART_EVENTS.exhausted, payload);
  }

  private async record(
    instanceId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.events.append(instanceId, eventType, { payload });
    } catch (err) {
      this.logger.warn({ instanceId, eventType, err }, "auto restart event not recorded");
    }
  }

  private prune(active: ReadonlySet<string>): void {
    for (const id of this.bots.keys()) {
      if (!active.has(id)) this.bots.delete(id);
    }
  }

  private stateFor(id: string): BotState {
    let state = this.bots.get(id);
    if (!state) {
      state = { consecutiveFailures: 0, restartsAt: [], restarting: false, exhaustedNotified: false };
      this.bots.set(id, state);
    }
    return state;
  }
}

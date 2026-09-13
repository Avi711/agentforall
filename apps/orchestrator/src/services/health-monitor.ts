import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { Instance, InstanceStatus } from "../domain/types.js";
import { isContainerBooting, type ContainerRuntime, type ContainerState } from "./container-runtime.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import type { AgentRuntimeAdapter, WhatsappLinkState } from "./agent-runtime/types.js";
import { mapWithConcurrency } from "./concurrency.js";

interface HealthMonitorConfig {
  pollIntervalMs: number;
  channelPollIntervalMs: number;
  channelStateMaxAgeMs: number;
  channelProbeMaxBackoffMs: number;
  degradedThreshold: number;
  unhealthyThreshold: number;
  requestTimeoutMs: number;
  channelProbeTimeoutMs: number;
  useDockerNetwork: boolean;
  maxConcurrentChecks: number;
}

interface HealthResult {
  healthy: boolean;
  liveness: LivenessSample;
  whatsappDisconnected: boolean;
}

// "down" needs a running, settled container; anything not established (missing, Docker unreachable) is "unknown".
export type LivenessSample = "live" | "down" | "booting" | "unknown";

export interface LivenessReport {
  instance: Instance;
  sample: LivenessSample;
}

export interface LivenessObserver {
  observe(report: readonly LivenessReport[]): void;
}

interface LocatedContainer {
  containerId: string;
  state: ContainerState;
}

// A healthy row is rewritten only this often; every poll writing every bot is what does not scale.
const LAST_SEEN_REFRESH_MS = 60_000;

// Cheap gateway liveness runs every poll; the costlier channel probe runs on its own cadence and
// its last established answer is reused in between, so channel work can never delay liveness.
interface ChannelStateEntry {
  state: WhatsappLinkState;
  establishedAt: number;
  nextAttemptAt: number;
  consecutiveFailures: number;
}

export class HealthMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentPoll: Promise<void> | null = null;
  private readonly channelStates = new Map<string, ChannelStateEntry>();
  private readonly degradedInstances = new Set<string>();

  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly runtimes: AgentRuntimeRegistry,
    private readonly logger: FastifyBaseLogger,
    private readonly config: HealthMonitorConfig,
    private readonly now: () => number = Date.now,
    private readonly livenessObserver: LivenessObserver | null = null,
  ) {}

  start(): void {
    if (this.intervalHandle) return;
    this.logger.info(
      {
        intervalMs: this.config.pollIntervalMs,
        channelIntervalMs: this.config.channelPollIntervalMs,
      },
      "health monitor started",
    );
    void this.pollAll();
    this.intervalHandle = setInterval(
      () => void this.pollAll(),
      this.config.pollIntervalMs,
    );
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info("health monitor stopped");
    }
    await this.currentPoll;
  }

  async pollAll(): Promise<void> {
    if (this.currentPoll) {
      this.logger.warn("health monitor poll skipped; previous pass still running");
      return;
    }
    this.currentPoll = this.runPoll();
    try {
      await this.currentPoll;
    } finally {
      this.currentPoll = null;
    }
  }

  private async runPoll(): Promise<void> {
    try {
      const active = await this.repo.findByStatuses([
        "running",
        "degraded",
        "unhealthy",
      ]);
      this.pruneChannelStates(active);

      const results = await mapWithConcurrency(
        active,
        this.config.maxConcurrentChecks,
        (inst) => this.checkOne(inst),
      );

      const report: LivenessReport[] = [];
      for (let i = 0; i < active.length; i++) {
        const inst = active[i]!;
        const result = results[i]!;
        const health: HealthResult =
          result.status === "fulfilled"
            ? result.value
            : { healthy: false, liveness: "unknown", whatsappDisconnected: false };
        report.push({ instance: inst, sample: health.liveness });

        try {
          await this.processResult(inst, health);
        } catch (err) {
          this.logger.error(
            { instanceId: inst.id, err },
            "failed to process health result",
          );
        }
      }
      this.notifyObserver(report);
    } catch (err) {
      this.logger.error({ err }, "health monitor poll failed");
    }
  }

  private notifyObserver(report: readonly LivenessReport[]): void {
    if (!this.livenessObserver) return;
    try {
      this.livenessObserver.observe(report);
    } catch (err) {
      this.logger.error({ err }, "liveness observer failed");
    }
  }

  private async processResult(
    inst: Instance,
    result: HealthResult,
  ): Promise<void> {
    if (result.healthy) {
      if (this.needsHealthyWrite(inst)) {
        await this.repo.updateHealth(inst.id, 0, "running", { markSeen: true });
      }
      if (inst.pairingStatus === "expired" && this.needsWhatsappProbe(inst)) {
        await this.repo.updatePairing(inst.id, { pairingStatus: "paired" });
      }
      if (inst.status !== "running" || inst.healthFailures > 0) {
        this.logger.info({ instanceId: inst.id }, "instance recovered");
      }
      return;
    }

    const failures = inst.healthFailures + 1;
    let newStatus: InstanceStatus = inst.status;

    if (failures >= this.config.unhealthyThreshold) {
      newStatus = "unhealthy";
    } else if (failures >= this.config.degradedThreshold) {
      newStatus = "degraded";
    }

    await this.repo.updateHealth(inst.id, failures, newStatus);

    if (
      newStatus === "unhealthy" &&
      result.whatsappDisconnected &&
      inst.pairingStatus === "paired"
    ) {
      await this.repo.updatePairing(inst.id, {
        pairingStatus: "expired",
        whatsappAccountId: null,
      });
      this.logger.warn(
        { instanceId: inst.id },
        "whatsapp channel disconnected",
      );
    }

    if (newStatus !== inst.status) {
      this.logger.warn(
        { instanceId: inst.id, failures, newStatus },
        "instance health changed",
      );
    }
  }

  private needsHealthyWrite(inst: Instance): boolean {
    if (inst.status !== "running" || inst.healthFailures > 0) return true;
    return inst.lastSeenAt === null || this.now() - inst.lastSeenAt.getTime() >= LAST_SEEN_REFRESH_MS;
  }

  // Docker is asked about a healthy bot once a minute (to repair a lagging container id), not every poll.
  private async checkOne(instance: Instance): Promise<HealthResult> {
    const adapter = this.runtimes.get(instance.runtimeKind);
    let located: LocatedContainer | "lookup_failed" | null | undefined;
    if (!instance.containerId || this.needsHealthyWrite(instance)) {
      located = await this.tryLocate(instance);
    }
    const resolved =
      located && located !== "lookup_failed" ? { ...instance, containerId: located.containerId } : instance;

    const liveness = await adapter
      .probeGateway(
        resolved,
        this.config.requestTimeoutMs,
        this.config.useDockerNetwork,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          { instanceId: instance.id, err },
          "gateway liveness probe failed",
        );
        return { healthy: false, degraded: null };
      });

    if (!liveness.healthy) {
      if (located === undefined) located = await this.tryLocate(instance);
      return {
        healthy: false,
        liveness: livenessOfFailure(located, this.now()),
        whatsappDisconnected: false,
      };
    }
    this.trackReadiness(instance.id, liveness.degraded);
    if (!this.needsWhatsappProbe(resolved)) {
      return { healthy: true, liveness: "live", whatsappDisconnected: false };
    }

    const state = await this.resolveWhatsappState(resolved, adapter);
    // Only a definite "disconnected" degrades the instance: a probe that could not answer says
    // nothing about the channel, and must never take a live tenant down.
    if (state === "disconnected") {
      return { healthy: false, liveness: "live", whatsappDisconnected: true };
    }
    return { healthy: true, liveness: "live", whatsappDisconnected: false };
  }

  // Logged on transition only: a permanently unready gateway must not flood every poll.
  private trackReadiness(instanceId: string, degraded: boolean | null): void {
    if (degraded === null) return;
    const wasDegraded = this.degradedInstances.has(instanceId);
    if (degraded && !wasDegraded) {
      this.degradedInstances.add(instanceId);
      this.logger.warn({ instanceId }, "gateway live but not ready");
    } else if (!degraded && wasDegraded) {
      this.degradedInstances.delete(instanceId);
      this.logger.info({ instanceId }, "gateway ready again");
    }
  }

  private async resolveWhatsappState(
    instance: Instance,
    adapter: AgentRuntimeAdapter,
  ): Promise<WhatsappLinkState> {
    const now = this.now();
    const entry = this.channelStates.get(instance.id);
    if (entry && now < entry.nextAttemptAt) {
      return effectiveState(entry, now, this.config.channelStateMaxAgeMs);
    }

    const probed = await adapter
      .probeWhatsapp(
        instance,
        this.config.channelProbeTimeoutMs,
        this.config.useDockerNetwork,
      )
      .catch((err: unknown) => {
        this.logger.warn({ instanceId: instance.id, err }, "whatsapp probe threw");
        return "probe_failed" as const;
      });

    if (probed === "probe_failed" || probed === "protocol_error") {
      const consecutiveFailures = (entry?.consecutiveFailures ?? 0) + 1;
      const next: ChannelStateEntry = {
        state: entry?.state ?? "unknown",
        establishedAt: entry?.establishedAt ?? 0,
        consecutiveFailures,
        nextAttemptAt: now + this.backoffMs(consecutiveFailures),
      };
      this.channelStates.set(instance.id, next);
      this.logger.warn(
        { instanceId: instance.id, reason: probed, consecutiveFailures },
        "whatsapp probe did not answer",
      );
      return effectiveState(next, now, this.config.channelStateMaxAgeMs);
    }

    this.channelStates.set(instance.id, {
      state: probed,
      establishedAt: now,
      consecutiveFailures: 0,
      nextAttemptAt: now + this.config.channelPollIntervalMs,
    });
    return probed;
  }

  private backoffMs(consecutiveFailures: number): number {
    const growth =
      this.config.channelPollIntervalMs * 2 ** (consecutiveFailures - 1);
    return Math.min(growth, this.config.channelProbeMaxBackoffMs);
  }

  private pruneChannelStates(active: readonly Instance[]): void {
    if (this.channelStates.size === 0 && this.degradedInstances.size === 0) return;
    const live = new Set(active.map((inst) => inst.id));
    for (const id of this.channelStates.keys()) {
      if (!live.has(id)) this.channelStates.delete(id);
    }
    for (const id of this.degradedInstances) {
      if (!live.has(id)) this.degradedInstances.delete(id);
    }
  }

  private needsWhatsappProbe(instance: Instance): boolean {
    return (
      Boolean(instance.containerId) &&
      instance.hasWhatsappCreds &&
      instance.config.channels.some((ch) => ch.type === "whatsapp")
    );
  }

  private async tryLocate(instance: Instance): Promise<LocatedContainer | "lookup_failed" | null> {
    try {
      return await this.locateContainer(instance);
    } catch (err) {
      this.logger.warn({ instanceId: instance.id, err }, "container lookup failed");
      return "lookup_failed";
    }
  }

  private async locateContainer(instance: Instance): Promise<LocatedContainer | null> {
    if (instance.containerId) {
      const current = await this.runtime.containerState(instance.containerId);
      if (current?.running) return { containerId: instance.containerId, state: current };
    }

    const byName = await this.runtime.findContainerByName(instance.containerName);
    if (!byName) return null;
    const state = await this.runtime.containerState(byName);
    if (!state) return null;
    if (byName !== instance.containerId) await this.repo.updateContainerId(instance.id, byName);
    return { containerId: byName, state };
  }
}

function livenessOfFailure(
  located: LocatedContainer | "lookup_failed" | null,
  now: number,
): LivenessSample {
  if (located === "lookup_failed" || located === null) return "unknown";
  if (!located.state.running) return "unknown";
  return isContainerBooting(located.state, now) ? "booting" : "down";
}

// A state nobody has confirmed for too long stops counting as evidence.
function effectiveState(
  entry: ChannelStateEntry,
  now: number,
  maxAgeMs: number,
): WhatsappLinkState {
  if (entry.establishedAt === 0) return "unknown";
  if (now - entry.establishedAt > maxAgeMs) return "unknown";
  return entry.state;
}

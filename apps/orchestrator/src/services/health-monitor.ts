import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { Instance, InstanceStatus } from "../domain/types.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import type { AgentRuntimeAdapter, WhatsappLinkState } from "./agent-runtime/types.js";

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
  whatsappDisconnected: boolean;
}

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
  private polling = false;
  private readonly channelStates = new Map<string, ChannelStateEntry>();
  private readonly degradedInstances = new Set<string>();

  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly runtimes: AgentRuntimeRegistry,
    private readonly logger: FastifyBaseLogger,
    private readonly config: HealthMonitorConfig,
    private readonly now: () => number = Date.now,
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

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info("health monitor stopped");
    }
  }

  async pollAll(): Promise<void> {
    if (this.polling) {
      this.logger.warn("health monitor poll skipped; previous pass still running");
      return;
    }
    this.polling = true;

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

      for (let i = 0; i < active.length; i++) {
        const inst = active[i]!;
        const result = results[i]!;
        const health =
          result.status === "fulfilled"
            ? result.value
            : { healthy: false, whatsappDisconnected: false };

        try {
          await this.processResult(inst, health);
        } catch (err) {
          this.logger.error(
            { instanceId: inst.id, err },
            "failed to process health result",
          );
        }
      }
    } catch (err) {
      this.logger.error({ err }, "health monitor poll failed");
    } finally {
      this.polling = false;
    }
  }

  private async processResult(
    inst: Instance,
    result: HealthResult,
  ): Promise<void> {
    if (result.healthy) {
      await this.repo.updateHealth(inst.id, 0, "running", { markSeen: true });
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

  private async checkOne(instance: Instance): Promise<HealthResult> {
    const containerId = await this.resolveContainerId(instance);
    const resolved = containerId ? { ...instance, containerId } : instance;
    const adapter = this.runtimes.get(resolved.runtimeKind);

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
      return { healthy: false, whatsappDisconnected: false };
    }
    this.trackReadiness(instance.id, liveness.degraded);
    if (!this.needsWhatsappProbe(resolved)) {
      return { healthy: true, whatsappDisconnected: false };
    }

    const state = await this.resolveWhatsappState(resolved, adapter);
    // Only a definite "disconnected" degrades the instance: a probe that could not answer says
    // nothing about the channel, and must never take a live tenant down.
    if (state === "disconnected") {
      return { healthy: false, whatsappDisconnected: true };
    }
    return { healthy: true, whatsappDisconnected: false };
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

  private async resolveContainerId(instance: Instance): Promise<string | null> {
    if (instance.containerId) {
      const current = await this.runtime.inspect(instance.containerId);
      if (current?.State.Running) return instance.containerId;
    }

    const byName = await this.runtime.findContainerByName(instance.containerName);
    if (!byName) return null;
    await this.repo.updateContainerId(instance.id, byName);
    return byName;
  }
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await fn(items[index]!),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

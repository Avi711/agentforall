import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { Instance, InstanceStatus } from "../domain/types.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";

interface HealthMonitorConfig {
  pollIntervalMs: number;
  degradedThreshold: number;
  unhealthyThreshold: number;
  requestTimeoutMs: number;
  useDockerNetwork: boolean;
  maxConcurrentChecks: number;
}

interface HealthResult {
  healthy: boolean;
  whatsappDisconnected: boolean;
}

export class HealthMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly runtimes: AgentRuntimeRegistry,
    private readonly logger: FastifyBaseLogger,
    private readonly config: HealthMonitorConfig,
  ) {}

  start(): void {
    if (this.intervalHandle) return;
    this.logger.info(
      { intervalMs: this.config.pollIntervalMs },
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

  private async pollAll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const active = await this.repo.findByStatuses([
        "running",
        "degraded",
        "unhealthy",
      ]);

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
    const result = await this.runtimes
      .get(resolved.runtimeKind)
      .probe(
        resolved,
        this.config.requestTimeoutMs,
        this.config.useDockerNetwork,
      )
      .catch((err) => {
        this.logger.warn(
          { instanceId: instance.id, err },
          "agent runtime probe failed",
        );
        return { gatewayHealthy: false, whatsappState: "unknown" as const };
      });

    if (!result.gatewayHealthy) {
      return { healthy: false, whatsappDisconnected: false };
    }
    if (!this.needsWhatsappProbe(resolved)) {
      return { healthy: true, whatsappDisconnected: false };
    }

    if (result.whatsappState === "connected") {
      return { healthy: true, whatsappDisconnected: false };
    }
    return {
      healthy: false,
      whatsappDisconnected: result.whatsappState === "disconnected",
    };
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

import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { Instance, InstanceStatus } from "../domain/types.js";

interface HealthMonitorConfig {
  pollIntervalMs: number;
  degradedThreshold: number;
  unhealthyThreshold: number;
  requestTimeoutMs: number;
  useDockerNetwork: boolean;
}

export class HealthMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly repo: InstanceRepository,
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

      const results = await Promise.allSettled(
        active.map((inst) => this.checkOne(inst)),
      );

      for (let i = 0; i < active.length; i++) {
        const inst = active[i]!;
        const result = results[i]!;
        const healthy = result.status === "fulfilled" && result.value;

        try {
          await this.processResult(inst, healthy);
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
    healthy: boolean,
  ): Promise<void> {
    if (healthy) {
      if (inst.status !== "running" || inst.healthFailures > 0) {
        await this.repo.updateHealth(inst.id, 0, "running");
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

    if (newStatus !== inst.status) {
      this.logger.warn(
        { instanceId: inst.id, failures, newStatus },
        "instance health changed",
      );
    }
  }

  private async checkOne(instance: Instance): Promise<boolean> {
    const host = this.config.useDockerNetwork
      ? instance.containerName
      : "127.0.0.1";
    const port = this.config.useDockerNetwork
      ? 18789
      : instance.gatewayPort;

    try {
      const resp = await fetch(`http://${host}:${port}/healthz`, {
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

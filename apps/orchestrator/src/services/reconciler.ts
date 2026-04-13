import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { ContainerRuntime } from "./container-runtime.js";

const STALE_PROVISIONING_MS = 5 * 60 * 1000;

export class Reconciler {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async run(): Promise<void> {
    this.logger.info("reconciliation started");

    await this.cleanStaleProvisioning();
    await this.resolveOrphanedDestroys();
    await this.syncRunningInstances();

    this.logger.info("reconciliation complete");
  }

  private async cleanStaleProvisioning(): Promise<void> {
    const stale = await this.repo.findStaleProvisioning(STALE_PROVISIONING_MS);

    for (const inst of stale) {
      this.logger.warn(
        { instanceId: inst.id },
        "marking stale provisioning instance as error",
      );

      if (inst.containerId) {
        try {
          await this.runtime.remove(inst.containerId);
        } catch {
          // container may not exist
        }
      }

      await this.repo.updateStatus(inst.id, "error", {
        errorMessage: "stale provisioning — cleaned up during reconciliation",
      });
    }
  }

  private async resolveOrphanedDestroys(): Promise<void> {
    const destroying = await this.repo.findByStatuses(["destroying"]);

    for (const inst of destroying) {
      this.logger.warn(
        { instanceId: inst.id },
        "completing orphaned destroy",
      );

      if (inst.containerId) {
        try {
          await this.runtime.remove(inst.containerId);
        } catch {
          // container may already be gone
        }
      }

      await this.repo.updateStatus(inst.id, "destroyed");
    }
  }

  private async syncRunningInstances(): Promise<void> {
    const running = await this.repo.findByStatuses([
      "running",
      "degraded",
      "unhealthy",
    ]);

    for (const inst of running) {
      if (!inst.containerId) {
        await this.repo.updateStatus(inst.id, "error", {
          errorMessage: "no container ID on record",
        });
        continue;
      }

      const info = await this.runtime.inspect(inst.containerId);

      if (!info) {
        this.logger.warn(
          { instanceId: inst.id },
          "container not found — marking error",
        );
        await this.repo.updateStatus(inst.id, "error", {
          errorMessage: "container not found during reconciliation",
        });
        continue;
      }

      if (!info.State.Running) {
        this.logger.info(
          { instanceId: inst.id },
          "container stopped — updating status",
        );
        await this.repo.updateStatus(inst.id, "stopped");
      }
    }
  }
}

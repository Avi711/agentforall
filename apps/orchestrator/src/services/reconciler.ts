import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { InstanceManager } from "./instance-manager.js";
import type { PairingManager } from "./pairing-manager.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import { errorMessage } from "../domain/errors.js";

const STALE_PROVISIONING_MS = 5 * 60 * 1000;
// Skip inspection of rows touched within this window — any in-flight operation
// (provisioning write, pair-complete restart, manual status update) bumps
// updatedAt, and the reconciler's job is to heal stuck state, not race with
// concurrent writers.
const RECONCILER_FRESHNESS_GRACE_MS = 30_000;

export interface ReconcilerDeps {
  repo: InstanceRepository;
  runtime: ContainerRuntime;
  runtimes: AgentRuntimeRegistry;
  manager: InstanceManager;
  pairingManager: PairingManager;
  logger: FastifyBaseLogger;
  pairingStaleThresholdMs: number;
}

export class Reconciler {
  constructor(private readonly deps: ReconcilerDeps) {}

  async run(): Promise<void> {
    this.deps.logger.info("reconciliation started");

    await this.resumeStaleProvisioning();
    await this.resolveOrphanedDestroys();
    await this.syncRunningInstances();
    await this.expireStalePairings();

    this.deps.logger.info("reconciliation complete");
  }

  private async resumeStaleProvisioning(): Promise<void> {
    const stale = await this.deps.repo.findStaleProvisioning(
      STALE_PROVISIONING_MS,
    );

    for (const inst of stale) {
      this.deps.logger.info(
        { instanceId: inst.id },
        "attempting to resume stale provisioning",
      );
      try {
        await this.deps.manager.resumeProvisioning(inst.id);
      } catch (err) {
        this.deps.logger.warn(
          { instanceId: inst.id, err: errorMessage(err) },
          "resume failed — row already marked error",
        );
      }
    }
  }

  private async resolveOrphanedDestroys(): Promise<void> {
    const destroying = await this.deps.repo.findByStatuses(["destroying"]);

    for (const inst of destroying) {
      this.deps.logger.warn(
        { instanceId: inst.id },
        "completing orphaned destroy",
      );

      // Re-wipe credentials defensively. InstanceManager.destroy() already
      // clears them before removal, but a reconciler-completed destroy may
      // cover paths (old rows, direct-to-DB writes) where that didn't happen.
      await this.deps.repo.updatePairing(inst.id, {
        whatsappCreds: null,
        whatsappAccountId: null,
        pairingStatus: "none",
      });

      if (inst.containerId) {
        try {
          await this.deps.runtime.remove(inst.containerId);
        } catch (err) {
          this.deps.logger.warn(
            { instanceId: inst.id, err: errorMessage(err) },
            "destroy reconciliation removal failed",
          );
          continue;
        }
      }

      try {
        await this.deps.runtime.removeVolume(
          this.deps.runtimes.get(inst.runtimeKind).stateVolumeName(inst.id),
        );
      } catch (err) {
        this.deps.logger.warn(
          { instanceId: inst.id, err: errorMessage(err) },
          "destroy reconciliation volume removal failed",
        );
        continue;
      }

      await this.deps.repo.updateStatus(inst.id, "destroyed");
    }
  }

  private async syncRunningInstances(): Promise<void> {
    const running = await this.deps.repo.findByStatuses([
      "running",
      "degraded",
      "unhealthy",
    ]);

    const freshnessCutoff = new Date(Date.now() - RECONCILER_FRESHNESS_GRACE_MS);

    for (const inst of running) {
      if (inst.updatedAt > freshnessCutoff) continue;

      if (!inst.containerId) {
        await this.deps.repo.updateStatus(inst.id, "error", {
          errorMessage: "no container ID on record",
        });
        continue;
      }

      const info = await this.deps.runtime.inspect(inst.containerId);

      if (!info) {
        this.deps.logger.warn(
          { instanceId: inst.id },
          "container not found — marking error",
        );
        await this.deps.repo.updateStatus(inst.id, "error", {
          errorMessage: "container not found during reconciliation",
        });
        continue;
      }

      if (!info.State.Running) {
        this.deps.logger.info(
          { instanceId: inst.id },
          "container stopped — updating status",
        );
        await this.deps.repo.updateStatus(inst.id, "stopped");
      }
    }
  }

  private async expireStalePairings(): Promise<void> {
    await this.deps.pairingManager.expireStale(this.deps.pairingStaleThresholdMs);
  }
}

import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { InstanceManager } from "./instance-manager.js";
import type { PairingManager } from "./pairing-manager.js";
import { groupByHost, type HostRuntimes } from "./host-runtimes.js";
import { errorMessage } from "../domain/errors.js";
import type { Instance } from "../domain/types.js";

const STALE_PROVISIONING_MS = 5 * 60 * 1000;
// Skip inspection of rows touched within this window — any in-flight operation
// (provisioning write, pair-complete restart, manual status update) bumps
// updatedAt, and the reconciler's job is to heal stuck state, not race with
// concurrent writers.
const RECONCILER_FRESHNESS_GRACE_MS = 30_000;

export interface ReconcilerDeps {
  repo: InstanceRepository;
  hosts: HostRuntimes;
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
    await this.deps.manager.purgeMovedSources();

    this.deps.logger.info("reconciliation complete");
  }

  // Rows on a host that does not answer wait: touching them would burn provisioning to error and mark live bots stopped.
  private async onReachableHosts(rows: readonly Instance[]): Promise<Instance[]> {
    const reachable: Instance[] = [];
    for (const [hostId, group] of groupByHost(rows)) {
      if (await this.deps.hosts.for(hostId).gate.check()) reachable.push(...group);
    }
    return reachable;
  }

  private async resumeStaleProvisioning(): Promise<void> {
    const stale = await this.onReachableHosts(
      await this.deps.repo.findStaleProvisioning(STALE_PROVISIONING_MS),
    );

    for (const inst of stale) {
      // A move mid-boot holds the lock for minutes; queueing behind it would stall the whole run.
      if (this.deps.manager.isOperating(inst.id)) continue;
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
    const destroying = await this.onReachableHosts(await this.deps.repo.findByStatuses(["destroying"]));

    for (const inst of destroying) {
      this.deps.logger.warn(
        { instanceId: inst.id },
        "completing orphaned destroy",
      );
      try {
        await this.completeDestroy(inst);
      } catch (err) {
        this.deps.logger.warn(
          { instanceId: inst.id, err: errorMessage(err) },
          "orphaned destroy could not complete",
        );
      }
    }
  }

  private async completeDestroy(inst: Instance): Promise<void> {
    // Re-wiped defensively: destroy() clears creds itself, but old rows or direct DB writes may have skipped it.
    await this.deps.repo.updatePairing(inst.id, {
      whatsappPaired: false,
      whatsappAccountId: null,
      pairingStatus: "none",
    });

    const { runtime, adapters } = this.deps.hosts.for(inst.hostId);
    if (inst.containerId) await runtime.remove(inst.containerId);
    await runtime.removeVolume(adapters.get(inst.runtimeKind).stateVolumeName(inst.id));
    await this.deps.repo.updateStatus(inst.id, "destroyed");
  }

  private async syncRunningInstances(): Promise<void> {
    const running = await this.onReachableHosts(
      await this.deps.repo.findByStatuses(["running", "degraded", "unhealthy"]),
    );

    const freshnessCutoff = new Date(Date.now() - RECONCILER_FRESHNESS_GRACE_MS);

    for (const inst of running) {
      if (inst.updatedAt > freshnessCutoff || this.deps.manager.isOperating(inst.id)) continue;
      try {
        await this.syncOne(inst);
      } catch (err) {
        this.deps.logger.warn(
          { instanceId: inst.id, err: errorMessage(err) },
          "container sync failed",
        );
      }
    }
  }

  private async syncOne(inst: Instance): Promise<void> {
    const container = await this.resolveContainer(inst);
    if (container === null) {
      this.deps.logger.warn(
        { instanceId: inst.id },
        "container not found — marking error",
      );
      await this.deps.repo.updateStatus(inst.id, "error", {
        errorMessage: "container not found during reconciliation",
      });
      return;
    }

    if (container.running) return;

    // A "no"-policy host never restarts a bot itself, so a stopped container there was left by a host restart.
    const host = this.deps.hosts.for(inst.hostId);
    if (host.restartPolicy === "no") {
      await host.runtime.start(container.containerId);
      this.deps.logger.info({ instanceId: inst.id }, "re-adopted bot after host restart");
      return;
    }
    this.deps.logger.info(
      { instanceId: inst.id },
      "container stopped — updating status",
    );
    await this.deps.repo.updateStatus(inst.id, "stopped");
  }

  // The row's id can lag a crashed rebuild; the container name is the durable handle.
  private async resolveContainer(inst: Instance): Promise<{ containerId: string; running: boolean } | null> {
    const { runtime } = this.deps.hosts.for(inst.hostId);
    if (inst.containerId) {
      const state = await runtime.containerState(inst.containerId);
      if (state) return { containerId: inst.containerId, running: state.running };
    }
    const byName = await runtime.findContainerByName(inst.containerName);
    if (!byName) return null;
    const state = await runtime.containerState(byName);
    if (!state) return null;
    await this.deps.repo.updateContainerId(inst.id, byName);
    return { containerId: byName, running: state.running };
  }

  // expireStale cannot skip rows per host, so it waits while any host is out: an expired pairing must have its sidecar torn down.
  private async expireStalePairings(): Promise<void> {
    for (const host of this.deps.hosts.all()) {
      if (!(await host.gate.check())) return;
    }
    await this.deps.pairingManager.expireStale(this.deps.pairingStaleThresholdMs);
  }
}

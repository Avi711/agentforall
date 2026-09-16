import { randomBytes, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import { isUniqueViolation } from "../storage/pg-errors.js";
import { isContainerBooting } from "./container-runtime.js";
import type { PortAllocator } from "./port-allocator.js";
import type { Placement } from "./placement.js";
import type { SystemRestartOutcome } from "./auto-restarter.js";
import type { EventRepository, ProvisioningEvent } from "../storage/event-repository.js";
import type { PairingManager } from "./pairing-manager.js";
import type { AppConfig } from "../config.js";
import { dialUrl, type HostRuntime, type HostRuntimes } from "./host-runtimes.js";
import type { AgentRuntimeAdapter, ConfigApplyOutcome } from "./agent-runtime/types.js";
import type {
  LlmKeyProvisioner,
  LiteLlmProvisionResult,
} from "./litellm-key-manager.js";
import {
  NotFoundError,
  InvalidStateError,
  ValidationError,
  QuotaExceededError,
  InvalidBackupError,
  UpstreamUnavailableError,
  ConflictError,
  FeatureUnavailableError,
  UnknownHostError,
  errorMessage,
} from "../domain/errors.js";
import {
  isValidTransition,
  DEFAULT_RESOURCE_LIMITS,
  USER_ID_PATTERN,
  type Instance,
  type InstanceConfig,
  type InstanceStatus,
  type ConfigPatch,
  type CreateInstanceInput,
  type AgentRuntimeKind,
  type BotUsage,
  type ChannelConfig,
  type TelegramChannelConfig,
  isContainerUp,
} from "../domain/types.js";
import { InstanceOperationLock } from "./instance-operation-lock.js";
import type { ProvisioningStage } from "../domain/provisioning.js";
import type { TelegramBotApi } from "./telegram/bot-api.js";
import {
  applyChannelDefaults,
  findTelegramChannel,
  findWhatsappChannel,
  withWhatsappOwnerNumber,
} from "../domain/channels.js";
import { freshRelayToken } from "./relay.js";
import { withTenantCa } from "./tenant-ca.js";

export interface AgentBackupRestoreStorage {
  openObjectStream(
    objectName: string,
    maxBytes: number,
  ): Promise<{ body: Readable; contentLength: number; contentType: string | null }>;
  deleteObject(objectName: string): Promise<void>;
}

// The moves bucket: an unsized tar goes up, the target streams it back down.
export interface MoveStorage extends AgentBackupRestoreStorage {
  uploadObjectStream(input: {
    objectName: string;
    contentType: string;
    body: Readable;
  }): Promise<{ contentLength: number }>;
}

export interface AgentBackupStream {
  stdout: Readable;
  contentLength: number;
  done: Promise<void>;
}

// Docker's healthcheck StartPeriod is 90s; give a booting container that long plus slack before restarting it.
const STARTUP_SETTLE_MS = 120_000;
const RESTARTABLE_STATUSES: readonly InstanceStatus[] = ["running", "degraded", "unhealthy"];
const MOVABLE_STATUSES: readonly InstanceStatus[] = ["running", "degraded", "unhealthy", "stopped"];
const MOVE_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;
// A whole volume, session and media included; far above any bot seen so far.
const MOVE_MAX_BYTES = 20 * 1024 * 1024 * 1024;
// A stalled archive stream must not hold the bot's lock forever; the size cap above bounds the honest case.
const MOVE_STREAM_TIMEOUT_MS = 30 * 60 * 1000;

const skipped = (reason: string): SystemRestartOutcome => ({ restarted: false, reason, transient: true });
const blocked = (reason: string): SystemRestartOutcome => ({ restarted: false, reason, transient: false });

export interface InstanceDetails extends Instance {
  provisioningStage: ProvisioningStage | null;
  provisioningHistory: ProvisioningEvent[];
}

export class InstanceManager {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly hosts: HostRuntimes,
    private readonly portAllocator: PortAllocator,
    private readonly placement: Placement,
    private readonly appConfig: AppConfig,
    private readonly eventLog: EventRepository,
    private readonly pairingManager: PairingManager,
    private readonly llmKeys: LlmKeyProvisioner,
    private readonly logger: FastifyBaseLogger,
    private readonly backupRestoreStorage: AgentBackupRestoreStorage | null = null,
    private readonly operationLock = new InstanceOperationLock(),
    private readonly telegramApi: TelegramBotApi | null = null,
    private readonly integrationCleanup: IntegrationCleanup | null = null,
    // WhatsApp Business connect takes this before the instance lock; destroy takes it first too, so neither waits on the other.
    private readonly channelLock: InstanceOperationLock | null = null,
    private readonly moveStorage: MoveStorage | null = null,
  ) {}

  async create(userId: string, rawInput: CreateInstanceInput): Promise<Instance> {
    this.validateUserId(userId);

    const input: CreateInstanceInput = {
      ...rawInput,
      channels: applyChannelDefaults(rawInput.channels),
    };
    const reserved = await this.reserveIdentity(userId, input);
    await this.eventLog.append(reserved.id, "provision.requested", {
      actor: userId,
    });

    // Provisioning is idempotent; the reconciler resumes escaped failures.
    if (input.backupImport) {
      await this.resumeProvisioning(reserved.id);
      return this.requireInstance(reserved.id);
    }

    void this.resumeProvisioning(reserved.id).catch((err) => {
      this.logger.error(
        { instanceId: reserved.id, err },
        "background provisioning failed",
      );
    });

    return reserved;
  }

  // Reconciler calls this to recover from mid-provision crashes.
  async resumeProvisioning(
    id: string,
  ): Promise<Instance> {
    return this.operationLock.run(id, () => this.resumeProvisioningLocked(id));
  }

  private async resumeProvisioningLocked(id: string): Promise<Instance> {
    const inst = await this.requireInstance(id);
    if (inst.status === "running") return inst;
    if (inst.status !== "provisioning") {
      throw new InvalidStateError(inst.status, "running");
    }

    try {
      const containerId = await this.ensureContainerExists(inst);
      if (inst.containerId !== containerId) {
        await this.repo.updateContainerId(id, containerId);
        await this.eventLog.append(id, "provision.container_created", {
          payload: { containerId },
        });
      }

      if (inst.moveObjectName && inst.moveImportedAt === null) {
        const state = await this.hosts.for(inst.hostId).runtime.containerState(containerId);
        if (!state) throw new UpstreamUnavailableError("docker", "target container vanished before the import");
        // The archive goes into a never-started container only; anything that ran has state of its own by now.
        if (state.startedAt !== null) throw new ConflictError("target container started before the archive was imported");
        await this.restoreMovedVolume(inst, containerId, inst.moveObjectName);
        await this.repo.markMoveImported(id);
      }

      // Restore into the not-yet-started container: one boot, no restart mid-migration.
      if (inst.backupImport.status === "pending") {
        await this.restoreAgentBackup(inst, containerId);
        await this.eventLog.append(id, "provision.backup_restored");
      }

      // A bot moved while stopped lands stopped: its volume is in place, nothing boots.
      const leaveStopped = inst.moveObjectName !== null && inst.stoppedAt !== null;
      if (!leaveStopped) {
        await this.ensureContainerStarted(inst, containerId);
        await this.eventLog.append(id, "provision.started");

        // "running" means the gateway answered its health check, not merely that the process exists.
        // If it never does, promote anyway so the health monitor owns it from here.
        if (!(await this.hosts.for(inst.hostId).runtime.waitForHealthy(containerId, STARTUP_SETTLE_MS))) {
          this.logger.warn({ instanceId: id }, "gateway not healthy after start-up window");
        }
      }

      const promoted = inst.moveObjectName
        ? await this.repo.completeMove(id, leaveStopped ? "stopped" : "running")
        : await this.repo.updateStatus(id, "running", { expectedStatus: "provisioning" });
      if (promoted && !leaveStopped) {
        await this.eventLog.append(id, "provision.running");
        this.logger.info({ instanceId: id }, "instance provisioned");
      }
      // The bucket lifecycle catches what this misses.
      if (promoted && inst.moveObjectName) {
        await this.moveStorage
          ?.deleteObject(inst.moveObjectName)
          .catch((err) => this.logger.warn({ instanceId: id, err }, "move object cleanup failed"));
      }

      return await this.requireInstance(id);
    } catch (err) {
      this.logger.error({ instanceId: id, err }, "provisioning failed");
      await this.repo.updateStatus(id, "error", {
        errorMessage: errorMessage(err),
      });
      await this.cleanupPartial(inst);
      await this.eventLog.append(id, "provision.failed", {
        payload: { error: errorMessage(err) },
      });
      throw err;
    }
  }

  async get(id: string, userId: string): Promise<Instance> {
    return this.requireOwnedInstance(id, userId);
  }

  // Detail view: the recorded provisioning stages let clients show real progress, and the
  // final poll (already `running`) must still carry them so step timings survive.
  async describe(id: string, userId: string): Promise<InstanceDetails> {
    const inst = await this.requireOwnedInstance(id, userId);
    const provisioningHistory = await this.eventLog.provisioningHistory(id);
    return {
      ...inst,
      provisioningStage: provisioningHistory.at(-1)?.stage ?? null,
      provisioningHistory,
    };
  }

  async list(
    userId: string,
    cursor?: { createdAt: Date; id: string },
    limit?: number,
  ): Promise<Instance[]> {
    return this.repo.findByUserId(userId, cursor, limit);
  }

  async start(id: string, userId: string): Promise<void> {
    return this.operationLock.run(id, () => this.startLocked(id, userId));
  }

  private async startLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    this.assertTransition(inst.status, "running");

    if (!inst.containerId) {
      throw new InvalidStateError(inst.status, "running");
    }

    const updated = await this.repo.updateStatus(id, "running", {
      expectedStatus: inst.status,
    });
    if (!updated) throw new InvalidStateError(inst.status, "running");

    try {
      const { containerId } = await this.containerForBoot(inst);
      await this.hosts.for(inst.hostId).runtime.start(containerId);
    } catch (err) {
      await this.repo.updateStatus(id, inst.status, {
        expectedStatus: "running",
      });
      throw err;
    }
    // A rebuild can outlast the reconciler's patience, which then marks the row stopped; the
    // container is running now, so the row says so regardless.
    await this.repo.updateStatus(id, "running");

    this.logger.info({ instanceId: id }, "instance started");
  }

  async stop(id: string, userId: string): Promise<void> {
    return this.operationLock.run(id, () => this.stopLocked(id, userId));
  }

  async restart(id: string, userId: string): Promise<void> {
    return this.operationLock.run(id, async () =>
      this.restartLocked(await this.requireOwnedInstance(id, userId)),
    );
  }

  // Re-checked inside the lock: a bot that answered again, or that a user just restarted, is left alone.
  async restartBySystem(id: string): Promise<SystemRestartOutcome> {
    return this.operationLock.run(id, async () => {
      const inst = await this.requireInstance(id);
      if (!RESTARTABLE_STATUSES.includes(inst.status)) return skipped(`bot is ${inst.status}`);
      if (!inst.containerId) return blocked("bot has no container on record");
      const host = this.hosts.for(inst.hostId);
      const state = await host.runtime.containerState(inst.containerId);
      if (!state?.running) return skipped("container is not running");
      if (isContainerBooting(state, Date.now())) return skipped("container is booting");
      if (!(await host.adapters.get(inst.runtimeKind).isOnCurrentImage(inst.containerId))) {
        return blocked("container is on another image; recreate is a supervised step");
      }
      if (await this.gatewayAnswers(inst)) return skipped("gateway answered");
      await this.restartLocked(inst, { failureStatus: inst.status });
      return { restarted: true };
    });
  }

  isOperating(id: string): boolean {
    return this.operationLock.isHeld(id);
  }

  private async gatewayAnswers(inst: Instance): Promise<boolean> {
    const host = this.hosts.for(inst.hostId);
    const adapter = host.adapters.get(inst.runtimeKind);
    const probe = await adapter
      .probeGateway(inst, this.appConfig.healthRequestTimeoutMs, dialUrl(host, inst, adapter.internalPort))
      // A probe that cannot even be sent is one more "no answer" from a bot the monitor already saw down.
      .catch(() => ({ healthy: false }));
    return probe.healthy;
  }

  private async restartLocked(
    inst: Instance,
    opts: { failureStatus: InstanceStatus } = { failureStatus: "error" },
  ): Promise<void> {
    const id = inst.id;
    if (!RESTARTABLE_STATUSES.includes(inst.status)) {
      throw new InvalidStateError(inst.status, "running");
    }
    if (!inst.containerId) {
      throw new InvalidStateError(inst.status, "running");
    }

    try {
      const { containerId, rebuilt } = await this.containerForBoot(inst);
      if (rebuilt) await this.hosts.for(inst.hostId).runtime.start(containerId);
      else await this.restartContainer(inst, containerId);
    } catch (err) {
      await this.repo.updateStatus(id, opts.failureStatus, { errorMessage: errorMessage(err) });
      throw err;
    }
    await this.repo.updateStatus(id, "running");
    this.logger.info({ instanceId: id }, "instance restarted");
  }

  // The container to boot: the one under the bot's name (the row can lag a crashed rebuild) when
  // it is on the current image, otherwise a rebuilt one, since another image cannot boot this config.
  private async containerForBoot(inst: Instance): Promise<{ containerId: string; rebuilt: boolean }> {
    const existing = await this.existingContainerId(inst);
    const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);
    if (existing && (await adapter.isOnCurrentImage(existing))) {
      if (existing !== inst.containerId) await this.repo.updateContainerId(inst.id, existing);
      await this.refreshRuntimeConfig({ ...inst, containerId: existing });
      // Guidance changes ship with the orchestrator; a restart is when tenants pick them up.
      await this.seedWorkspace(inst, existing);
      return { containerId: existing, rebuilt: false };
    }
    const containerId = await this.recreateContainer(inst);
    await this.eventLog.append(inst.id, "instance.recreated", {
      payload: { containerId, reason: "runtime_image" },
    });
    return { containerId, rebuilt: true };
  }

  async recreate(id: string, userId: string): Promise<void> {
    return this.operationLock.run(id, () => this.recreateLocked(id, userId));
  }

  // Rebuilds the container from the currently configured runtime image; the state volume persists and,
  // once paired, owns the WhatsApp session: the pairing-time copy in the DB is never written over it.
  private async recreateLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    if (!["running", "degraded", "unhealthy", "error"].includes(inst.status)) {
      throw new InvalidStateError(inst.status, "running");
    }
    // The volume here is empty or partial; booting it would pass for a finished move and let the sweeper take the real copy.
    if (inst.moveObjectName !== null) {
      throw new ConflictError(`the move to host ${inst.hostId} never finished; move the bot back to host ${inst.movedFromHostId} first`);
    }

    const { runtime } = this.hosts.for(inst.hostId);
    try {
      const containerId = await this.recreateContainer(inst);
      await runtime.start(containerId);
      // The migration can outlast the reconciler's patience (row marked stopped or error meanwhile);
      // the container is running now, so the row says so regardless.
      await this.repo.updateStatus(id, "running");
      await this.eventLog.append(id, "instance.recreated", {
        actor: userId,
        payload: { containerId },
      });
      if (!(await runtime.waitForHealthy(containerId, STARTUP_SETTLE_MS))) {
        this.logger.warn({ instanceId: id }, "gateway not healthy after recreate");
      }
    } catch (err) {
      // Old or new, a container under the bot's name boots on the next start; unknown counts as none.
      const bootable = await runtime.findContainerByName(inst.containerName).catch(() => null);
      await this.repo.updateStatus(id, bootable ? "stopped" : "error", {
        errorMessage: errorMessage(err),
      });
      throw err;
    }

    this.logger.info({ instanceId: id }, "instance recreated");
  }

  // Stop, migrate the volume, only then remove: a failed migration leaves the bot startable as it was.
  private async recreateContainer(current: Instance): Promise<string> {
    const inst = await this.ensureIntegrationsBinding(current);
    const { runtime, adapters } = this.hosts.for(inst.hostId);
    const adapter = adapters.get(inst.runtimeKind);
    const existing = await this.existingContainerId(inst);
    if (existing && (await runtime.isRunning(existing))) {
      await runtime.stop(existing);
    }
    await adapter.prepareState(inst);
    if (existing) await runtime.remove(existing);
    const containerId = await this.ensureContainerExists({ ...inst, containerId: null });
    await this.repo.updateContainerId(inst.id, containerId);
    return containerId;
  }

  // The row's id can be stale after a crash mid-rebuild; the name is the durable handle.
  private async existingContainerId(inst: Instance): Promise<string | null> {
    const { runtime } = this.hosts.for(inst.hostId);
    if (inst.containerId && (await runtime.containerState(inst.containerId))) return inst.containerId;
    return runtime.findContainerByName(inst.containerName);
  }

  // Best effort: guidance missing from a workspace is a support ticket, not a broken bot.
  private async seedWorkspace(inst: Instance, containerId: string): Promise<void> {
    try {
      await this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind).seedWorkspace(containerId);
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "workspace guidance seed failed");
    }
  }

  private async ensureIntegrationsBinding(inst: Instance): Promise<Instance> {
    if (inst.config.integrations) return inst;
    const binding = this.newIntegrationsBinding();
    if (!binding) return inst;
    const config: InstanceConfig = { ...inst.config, integrations: binding };
    await this.repo.updateConfig(inst.id, config);
    return { ...inst, config };
  }

  private newIntegrationsBinding(): InstanceConfig["integrations"] {
    if (!this.appConfig.integrationsProvider) return undefined;
    return { relayToken: freshRelayToken() };
  }

  private async stopLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    this.assertTransition(inst.status, "stopped");

    if (!inst.containerId) {
      throw new InvalidStateError(inst.status, "stopped");
    }

    const updated = await this.repo.updateStatus(id, "stopped", {
      expectedStatus: inst.status,
    });
    if (!updated) throw new InvalidStateError(inst.status, "stopped");

    try {
      await this.hosts.for(inst.hostId).runtime.stop(inst.containerId);
    } catch (err) {
      await this.repo.updateStatus(id, inst.status, {
        expectedStatus: "stopped",
      });
      throw err;
    }

    this.logger.info({ instanceId: id }, "instance stopped");
  }

  async destroy(id: string, userId: string): Promise<void> {
    const destroy = () => this.operationLock.run(id, () => this.destroyLocked(id, userId));
    return this.channelLock ? this.channelLock.run(id, destroy) : destroy();
  }

  private async destroyLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    if (inst.status === "destroyed") return;

    if (inst.status !== "destroying" && inst.status !== "error") {
      this.assertTransition(inst.status, "destroying");

      const updated = await this.repo.updateStatus(id, "destroying", {
        expectedStatus: inst.status,
      });
      if (!updated) throw new InvalidStateError(inst.status, "destroying");
    }

    // The runtime must drop the linked-device entry while the container is alive.
    if (inst.hasWhatsappCreds && inst.containerId) {
      await this.pairingManager.logoutWhatsapp(id, inst.containerId);
    }

    // Failed container removal must still honor "delete everything".
    await this.repo.updatePairing(id, {
      whatsappPaired: false,
      whatsappAccountId: null,
      pairingStatus: "none",
    });

    // Stop the sidecar before removing the main container.
    await this.pairingManager.teardownSidecar(id, "destroy");
    await this.llmKeys.revoke(inst).catch((err) =>
      this.logger.warn({ instanceId: id, err }, "failed to revoke LiteLLM key"),
    );
    await this.revokeTelegramBot(inst);
    await this.integrationCleanup?.revokeAll(inst).catch((err) =>
      this.logger.warn({ instanceId: id, err }, "failed to revoke integrations"),
    );

    try {
      const { runtime, adapters } = this.hosts.for(inst.hostId);
      if (inst.containerId) {
        await runtime.remove(inst.containerId);
      }
      await runtime.removeVolume(adapters.get(inst.runtimeKind).stateVolumeName(inst.id));
      await this.repo.updateStatus(id, "destroyed");
      this.logger.info({ instanceId: id }, "instance destroyed");
    } catch (err) {
      this.logger.error({ instanceId: id, err }, "destroy failed");
      await this.repo.updateStatus(id, "error", { errorMessage: errorMessage(err) });
      throw err;
    }
  }

  // Operator-only; same row and identity, a new port on the target, the volume via the moves bucket. Lock order as destroy.
  async move(id: string, targetHostId: string, options: { dryRun?: boolean } = {}): Promise<void> {
    const move = () => this.operationLock.run(id, () => this.moveLocked(id, targetHostId, options.dryRun ?? false));
    return this.channelLock ? this.channelLock.run(id, move) : move();
  }

  private async moveLocked(id: string, targetHostId: string, dryRun: boolean): Promise<void> {
    const storage = this.moveStorage;
    if (!storage) throw new FeatureUnavailableError("moves");
    const inst = await this.requireInstance(id);
    // On the same host, a failed target boot would delete the only volume (cleanupPartial); a dry run flips nothing.
    if (targetHostId === inst.hostId && !dryRun) throw new ValidationError("bot is already on that host");
    if (inst.pairingStatus === "awaiting_qr" || inst.pairingStatus === "awaiting_code") {
      throw new InvalidStateError(inst.pairingStatus, "move");
    }
    if (inst.status === "error" && inst.movedFromHostId === targetHostId) {
      if (dryRun) throw new ValidationError("a rollback has no dry run");
      // Once promoted the target held the live state; the retained copy is stale and no longer a rollback.
      if (inst.moveObjectName === null) {
        throw new ConflictError(`the move to host ${inst.hostId} completed; recreate the bot there first`);
      }
      return this.moveBackLocked(inst, targetHostId);
    }
    if (!MOVABLE_STATUSES.includes(inst.status)) throw new InvalidStateError(inst.status, "move");
    // A second hop would overwrite the reference to the retained volume and leak it; an own-host dry run skips the target checks.
    if (inst.movedFromHostId !== null && inst.movedFromHostId !== targetHostId && !(dryRun && targetHostId === inst.hostId)) {
      throw new ConflictError(`the previous move's volume is still retained on host ${inst.movedFromHostId}`);
    }

    if (targetHostId !== inst.hostId) await this.prepareTarget(inst, targetHostId);
    const source = this.hosts.for(inst.hostId);
    const containerId = await this.resolveContainerId(inst);
    if (!containerId) throw new InvalidStateError(inst.status, "move");

    // An already-stopped bot keeps its "stopped since" stamp.
    if (inst.status !== "stopped") {
      const stopped = await this.repo.updateStatus(id, "stopped", { expectedStatus: inst.status });
      if (!stopped) throw new InvalidStateError(inst.status, "stopped");
    }
    await this.eventLog.append(id, "move.started", { payload: { from: inst.hostId, to: targetHostId, dryRun } });
    const objectName = `moves/${id}/${new Date().toISOString()}.tar`;

    let gatewayPort: number | null = null;
    try {
      if (await source.runtime.isRunning(containerId)) await source.runtime.stop(containerId);
      const { contentLength } = await storage.uploadObjectStream({
        objectName,
        contentType: "application/x-tar",
        body: await source.adapters.get(inst.runtimeKind).exportVolume(containerId, AbortSignal.timeout(MOVE_STREAM_TIMEOUT_MS)),
      });
      if (contentLength <= 0 || contentLength > MOVE_MAX_BYTES) {
        throw new Error(`exported volume archive is ${contentLength} bytes`);
      }
      await this.eventLog.append(id, "move.exported", { payload: { objectName, contentLength } });
      if (!dryRun) gatewayPort = await this.flipToHost(inst, targetHostId, objectName);
    } catch (err) {
      // A flip whose acknowledgement was lost has committed; unknown counts as flipped: the source stays stopped either way.
      const now = dryRun
        ? inst
        : await this.repo.findById(id).catch((readErr) => {
            this.logger.warn({ instanceId: id, err: readErr }, "row read after the failed move failed");
            return null;
          });
      if (now === null || now.hostId !== inst.hostId) {
        this.logger.warn({ instanceId: id, err }, "move flip unconfirmed; the source stays stopped, start it by hand if the row kept its host");
        if (now) {
          await this.eventLog.append(id, "move.flipped", { payload: { from: inst.hostId, to: targetHostId, gatewayPort: now.gatewayPort } });
        }
        throw err;
      }
      await this.eventLog.append(id, "move.failed", { payload: { to: targetHostId, error: errorMessage(err) } });
      // Nothing has moved: the bot is whole on its host, so it goes back to how it was.
      await storage.deleteObject(objectName).catch((cleanupErr) =>
        this.logger.warn({ instanceId: id, err: cleanupErr }, "move object cleanup failed"),
      );
      await this.resumeSource(inst, containerId).catch((resumeErr) =>
        this.logger.warn({ instanceId: id, err: resumeErr }, "source did not resume after a failed move"),
      );
      throw err;
    }

    if (gatewayPort === null) {
      await storage.deleteObject(objectName).catch((err) =>
        this.logger.warn({ instanceId: id, err }, "move object cleanup failed"),
      );
      await this.resumeSource(inst, containerId);
      await this.eventLog.append(id, "move.dry_run", { payload: { to: targetHostId } });
      this.logger.info({ instanceId: id, targetHostId }, "move dry run passed");
      return;
    }
    await this.eventLog.append(id, "move.flipped", { payload: { from: inst.hostId, to: targetHostId, gatewayPort } });

    // The named volume survives the removal; the sweeper deletes it after the retention window.
    await source.runtime.remove(containerId).catch((err) =>
      this.logger.warn({ instanceId: id, err }, "source container removal failed; the sweeper retries it"),
    );
    try {
      await this.resumeProvisioningLocked(id);
    } catch (err) {
      // The object stays for the rollback path; the bucket lifecycle deletes it otherwise.
      await this.eventLog.append(id, "move.failed", { payload: { to: targetHostId, error: errorMessage(err) } });
      throw err;
    }
    await this.eventLog.append(id, "move.completed", { payload: { from: inst.hostId, to: targetHostId, gatewayPort } });
    this.logger.info({ instanceId: id, from: inst.hostId, to: targetHostId, gatewayPort }, "instance moved");
  }

  private async prepareTarget(inst: Instance, targetHostId: string): Promise<void> {
    const target = this.managedHost(targetHostId);
    if (!(await target.gate.check())) throw new UpstreamUnavailableError("docker", `host ${targetHostId} is unreachable`);
    await this.placement.assertFits(targetHostId, inst.config.resources.memoryMb);
    const adapter = target.adapters.get(inst.runtimeKind);
    await target.runtime.ensureImagePulled(adapter.image);
    if (!(await target.runtime.hasVolume(adapter.stateVolumeName(inst.id)))) return;
    if (inst.movedFromHostId !== targetHostId || inst.moveObjectName !== null) {
      throw new ConflictError(`host ${targetHostId} already holds a state volume for this bot`);
    }
    // Moving back within retention: the copy left there is older than what the bot has now.
    await this.removeBotFromHost(target, inst);
  }

  // A failed target boot: the row returns, still `error`, to the host whose retained volume is the state; a recreate boots it there.
  private async moveBackLocked(inst: Instance, toHostId: string): Promise<void> {
    this.managedHost(toHostId);
    const target = this.hosts.for(inst.hostId);
    if (!(await target.gate.check())) throw new UpstreamUnavailableError("docker", `host ${inst.hostId} is unreachable`);
    const left = await target.runtime.findContainerByName(inst.containerName);
    const state = left ? await target.runtime.containerState(left) : null;
    // A container that ran on the imported archive wrote the live copy; the retained one is stale.
    if (state && state.startedAt !== null && inst.moveImportedAt !== null) {
      throw new ConflictError(`the target container ran on host ${inst.hostId}; recreate the bot there instead`);
    }
    // Whatever the failed boot left there would otherwise run beside the bot, or block a later move to that host.
    await this.removeBotFromHost(target, inst);
    const gatewayPort = await this.portAllocator.allocate(toHostId);
    const restored = await this.repo.moveBack(inst.id, { toHostId, gatewayPort });
    if (!restored) throw new InvalidStateError(inst.status, "move");
    await this.eventLog.append(inst.id, "move.rolled_back", { payload: { from: inst.hostId, to: toHostId, gatewayPort } });
    this.logger.warn(
      { instanceId: inst.id, from: inst.hostId, to: toHostId, gatewayPort },
      "move rolled back; recreate boots the bot on its old host",
    );
  }

  // The (host, port) index raises 23505 when a create on the target took the port first; try another.
  private async flipToHost(inst: Instance, targetHostId: string, objectName: string): Promise<number> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.appConfig.maxProvisionRetries; attempt++) {
      const gatewayPort = await this.portAllocator.allocate(targetHostId);
      try {
        const flipped = await this.repo.moveTo(inst.id, {
          fromHostId: inst.hostId,
          toHostId: targetHostId,
          gatewayPort,
          objectName,
          keepStopped: inst.status === "stopped",
        });
        if (!flipped) throw new InvalidStateError("stopped", "provisioning");
        return gatewayPort;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn({ instanceId: inst.id, port: gatewayPort, attempt }, "port conflict on the target; retrying");
      }
    }
    throw lastError ?? new Error("failed to place the bot on the target host");
  }

  // The source is intact after a dry run or a failure before the flip: a bot that was up comes back up.
  private async resumeSource(inst: Instance, containerId: string): Promise<void> {
    if (!isContainerUp(inst.status)) return;
    await this.hosts.for(inst.hostId).runtime.start(containerId);
    const resumed = await this.repo.updateStatus(inst.id, "running", { expectedStatus: "stopped" });
    if (!resumed) this.logger.warn({ instanceId: inst.id }, "source started but its row did not return to running");
  }

  private managedHost(hostId: string): HostRuntime {
    try {
      return this.hosts.for(hostId);
    } catch (err) {
      if (err instanceof UnknownHostError) throw new ValidationError(err.message);
      throw err;
    }
  }

  // The public patch cannot express the WhatsApp Business channel, so a channel list in it keeps the existing one.
  async updateConfig(
    id: string,
    userId: string,
    patch: ConfigPatch,
  ): Promise<Instance> {
    return this.operationLock.run(id, async () => {
      const inst = await this.requireOwnedInstance(id, userId);
      return this.updateConfigLocked(id, userId, keepOrchestratorChannels(inst.config.channels, patch));
    });
  }

  // Read-modify-write under the instance lock so concurrent channel writers can't lose updates.
  // Returning the same array from `mutate` means "no change": nothing is written or restarted.
  async updateChannels(
    id: string,
    userId: string,
    mutate: (channels: ChannelConfig[]) => ChannelConfig[],
  ): Promise<{ instance: Instance; changed: boolean }> {
    return this.operationLock.run(id, async () => {
      const inst = await this.requireOwnedInstance(id, userId);
      const next = mutate(inst.config.channels);
      if (next === inst.config.channels) return { instance: inst, changed: false };
      const instance = await this.updateConfigLocked(id, userId, { channels: next });
      return { instance, changed: true };
    });
  }

  async updateLiteLlmBudget(
    id: string,
    userId: string,
    budgetCents: number,
  ): Promise<Instance> {
    return this.operationLock.run(id, async () => {
      const inst = await this.requireOwnedInstance(id, userId);
      await this.llmKeys.updateBudget(inst, budgetCents);
      await this.repo.updateLiteLlmKey(id, {
        keyAlias: inst.litellm.keyAlias ?? `agentforall-${id.slice(0, 8)}`,
        keyHash: inst.litellm.keyHash,
        budgetCents,
        budgetDuration:
          inst.litellm.budgetDuration ??
          this.appConfig.litellmDefaultBudgetDuration,
      });
      await this.eventLog.append(id, "litellm.budget_updated", {
        actor: userId,
        payload: { budgetCents },
      });
      return this.requireOwnedInstance(id, userId);
    });
  }

  async getUsage(id: string, userId: string): Promise<BotUsage> {
    const inst = await this.requireOwnedInstance(id, userId);
    try {
      return await this.llmKeys.getBotUsage(inst);
    } catch (err) {
      this.logger.warn({ instanceId: id, err }, "LiteLLM usage lookup failed");
      throw new UpstreamUnavailableError("LiteLLM");
    }
  }

  private async updateConfigLocked(
    id: string,
    userId: string,
    patch: ConfigPatch,
  ): Promise<Instance> {
    const inst = await this.requireOwnedInstance(id, userId);

    if (inst.status === "provisioning" || inst.status === "destroying") {
      throw new InvalidStateError(inst.status, "config update");
    }

    const merged: InstanceConfig = {
      displayName: patch.displayName ?? inst.config.displayName,
      provider: patch.provider
        ? { ...inst.config.provider, ...patch.provider }
        : inst.config.provider,
      channels: patch.channels ?? inst.config.channels,
      resources: patch.resources
        ? { ...inst.config.resources, ...patch.resources }
        : inst.config.resources,
      ...integrationsAfterPatch(inst.config, patch),
    };

    // Container limits are fixed when the container is created, so accepting one here would report
    // success for a change the running container can never pick up.
    if (
      inst.containerId &&
      (merged.resources.memoryMb !== inst.config.resources.memoryMb ||
        merged.resources.cpuShares !== inst.config.resources.cpuShares)
    ) {
      throw new ValidationError("changing resources needs a recreate, not a config update");
    }

    // Config can be injected into stopped containers too. A hot-reloading runtime applies the file
    // itself; restarting it would only cause an outage (and can wedge a still-booting container).
    // The container has to take the config before the row claims it: persisting first would leave
    // the DB describing a bot that does not exist.
    const host = this.hosts.for(inst.hostId);
    const adapter = inst.containerId ? host.adapters.get(inst.runtimeKind) : null;
    let outcome: ConfigApplyOutcome | null = null;
    if (adapter && inst.containerId) {
      outcome = await adapter.applyConfig(inst.containerId, { ...inst, config: merged });
      await this.eventLog.append(id, `config.${outcome}`);
      this.logger.info({ instanceId: id, outcome }, "runtime config change");
    }

    await this.repo.updateConfig(id, merged);

    // A staged change is only on disk; a running container has to boot again to read it. The row
    // can lag reality (a reconciler can mark a serving container "error"), so the container decides.
    if (
      outcome === "restart_required" &&
      inst.containerId &&
      (await host.runtime.isRunning(inst.containerId))
    ) {
      await this.restartContainer(inst, inst.containerId);
    }

    return this.requireOwnedInstance(id, userId);
  }

  // Invalidates the managed bot's token so the orphaned Telegram bot can't be reused,
  // then strips the channel from the stored config. Best-effort: destroy must proceed.
  private async revokeTelegramBot(inst: Instance): Promise<void> {
    const telegram = findTelegramChannel(inst.config.channels);
    if (!telegram) return;
    await this.revokeTelegramToken(inst.id, telegram);
    try {
      await this.repo.updateConfig(inst.id, {
        ...inst.config,
        channels: inst.config.channels.filter((ch) => ch.type !== "telegram"),
      });
    } catch (err) {
      this.logger.warn(
        { instanceId: inst.id, err },
        "failed to strip telegram channel from config",
      );
    }
  }

  private async revokeTelegramToken(
    instanceId: string,
    telegram: TelegramChannelConfig,
  ): Promise<void> {
    if (!this.telegramApi || !telegram.botId) return;
    try {
      await this.telegramApi.replaceManagedBotToken(telegram.botId);
    } catch (err) {
      this.logger.warn({ instanceId, err }, "failed to revoke telegram bot token");
    }
  }

  // Adds the WhatsApp channel when missing and records who the owner writes from, so access is
  // allowlisted before the first message ever arrives.
  async ensureWhatsappChannel(
    id: string,
    userId: string,
    ownerNumber: string | null = null,
  ): Promise<Instance> {
    const { instance } = await this.updateChannels(id, userId, (channels) =>
      withWhatsappOwnerNumber(channels, ownerNumber),
    );
    return instance;
  }

  // Unlinks the device and clears creds; channel + access settings stay so the user can re-pair.
  async disconnectWhatsapp(id: string, userId: string): Promise<Instance> {
    return this.operationLock.run(id, async () => {
      const inst = await this.requireOwnedInstance(id, userId);
      if (!findWhatsappChannel(inst.config.channels)) {
        throw new NotFoundError("whatsapp channel", id);
      }
      if (inst.status === "provisioning" || inst.status === "destroying") {
        throw new InvalidStateError(inst.status, "whatsapp disconnect");
      }
      const containerUp = inst.containerId !== null && isContainerUp(inst.status);
      // Auth files on the volume can only be wiped via exec; otherwise they'd resurrect the session.
      if (inst.hasWhatsappCreds && !containerUp) {
        throw new InvalidStateError(inst.status, "whatsapp disconnect");
      }

      if (inst.pairingStatus === "awaiting_qr" || inst.pairingStatus === "awaiting_code") {
        await this.pairingManager.cancelPairing(id, "user_disconnected");
      }
      if (inst.hasWhatsappCreds && inst.containerId) {
        const cleared = await this.pairingManager.logoutWhatsapp(id, inst.containerId);
        // Dropping DB creds while auth files remain would let the session resurrect on restart.
        if (!cleared) throw new UpstreamUnavailableError("whatsapp logout");
      }
      await this.repo.updatePairing(id, {
        whatsappPaired: false,
        whatsappAccountId: null,
        pairingStatus: "none",
      });
      await this.eventLog.append(id, "whatsapp.disconnected", { actor: userId });

      // Restart so the runtime drops its in-memory socket; start() won't re-inject creds anymore.
      if (inst.containerId && containerUp) {
        await this.restartContainer(inst, inst.containerId);
      }
      return this.requireOwnedInstance(id, userId);
    });
  }

  // Revokes the managed bot's token and removes the channel; the runtime reloads without it.
  async disconnectTelegram(id: string, userId: string): Promise<Instance> {
    return this.operationLock.run(id, async () => {
      const inst = await this.requireOwnedInstance(id, userId);
      const telegram = findTelegramChannel(inst.config.channels);
      if (!telegram) throw new NotFoundError("telegram channel", id);
      if (inst.status === "provisioning" || inst.status === "destroying") {
        throw new InvalidStateError(inst.status, "telegram disconnect");
      }

      await this.revokeTelegramToken(id, telegram);
      const updated = await this.updateConfigLocked(id, userId, {
        channels: inst.config.channels.filter((ch) => ch.type !== "telegram"),
      });
      await this.eventLog.append(id, "telegram.disconnected", {
        actor: userId,
        payload: { botId: telegram.botId ?? null },
      });
      return updated;
    });
  }

  async exportAgentBackupStream(
    id: string,
    userId: string,
  ): Promise<AgentBackupStream> {
    const inst = await this.requireOwnedInstance(id, userId);
    const containerId = await this.resolveExportContainerId(inst);
    const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);

    const archive = await adapter.exportState(containerId);
    return {
      stdout: archive.stdout,
      contentLength: archive.contentLength,
      done: archive.done.then(async (result) => {
        if (result.exitCode !== 0) {
          throw new Error(
            `agent backup failed: ${result.stderr || result.exitCode}`,
          );
        }
        await this.eventLog.append(id, "backup.exported", { actor: userId });
      }),
    };
  }

  async assertAgentBackupReadable(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    await this.resolveExportContainerId(inst);
  }

  // Retry on port-allocation race; container creation happens later in resumeProvisioning.
  private async reserveIdentity(
    userId: string,
    input: CreateInstanceInput,
  ): Promise<Instance> {
    let lastError: Error | null = null;

    for (
      let attempt = 0;
      attempt < this.appConfig.maxProvisionRetries;
      attempt++
    ) {
      const id = randomUUID();
      const runtimeKind = this.appConfig.agentRuntimeKind as AgentRuntimeKind;
      const memoryMb = input.resources?.memoryMb ?? DEFAULT_RESOURCE_LIMITS.memoryMb;
      const hostId = await this.placement.choose(memoryMb);
      const containerName = this.hosts.for(hostId).adapters.get(runtimeKind).containerName(id);
      const gatewayToken = randomBytes(32).toString("hex");
      const gatewayPort = await this.portAllocator.allocate(hostId);
      let litellmProvision: LiteLlmProvisionResult | null = null;

      try {
        const provision = input.provider
          ? null
          : await this.llmKeys.provisionProvider(
              id,
              userId,
              input.displayName,
            );
        litellmProvision = provision;
        const provider = input.provider ?? provision?.provider;
        if (!provider) {
          throw new Error("provider provisioning returned no provider");
        }
        const integrations = this.newIntegrationsBinding();
        const config: InstanceConfig = {
          displayName: input.displayName,
          provider,
          channels: input.channels,
          resources: {
            memoryMb,
            cpuShares:
              input.resources?.cpuShares ?? DEFAULT_RESOURCE_LIMITS.cpuShares,
          },
          ...(integrations ? { integrations } : {}),
        };
        const inserted = await this.repo.insertIfUserActiveBelowLimit(
          {
            id,
            userId,
            hostId,
            displayName: config.displayName,
            runtimeKind,
            status: "provisioning",
            config,
            containerId: null,
            containerName,
            gatewayPort,
            gatewayToken,
            healthFailures: 0,
            errorMessage: null,
            stoppedAt: null,
            destroyedAt: null,
            backupImport: input.backupImport,
            litellm: litellmProvision
              ? {
                  keyAlias: litellmProvision.keyAlias,
                  keyHash: litellmProvision.keyHash,
                  budgetCents: litellmProvision.budgetCents,
                  budgetDuration: litellmProvision.budgetDuration,
                }
              : undefined,
          },
          this.appConfig.maxInstancesPerUser,
        );
        if (!inserted) {
          throw new QuotaExceededError("instances", this.appConfig.maxInstancesPerUser);
        }
        return inserted;
      } catch (err: unknown) {
        if (litellmProvision) {
          await this.llmKeys
            .revokeKey(litellmProvision.provider.apiKey)
            .catch((revokeErr) =>
              this.logger.warn(
                { instanceId: id, err: revokeErr },
                "failed to revoke unused LiteLLM key",
              ),
            );
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isUniqueViolation(err)) {
          this.logger.warn(
            { port: gatewayPort, attempt },
            "port conflict; retrying with new identity",
          );
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("failed to reserve instance identity");
  }

  // Config and guidance are written whether the container was found or created, so one left
  // behind by a crash between create and write never boots on whatever the volume held.
  private async ensureContainerExists(inst: Instance): Promise<string> {
    const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);
    const containerId = await this.findOrCreateContainer(inst, adapter);
    await adapter.writeConfig(containerId, { ...inst, containerId });
    await this.seedWorkspace(inst, containerId);
    return containerId;
  }

  private async findOrCreateContainer(inst: Instance, adapter: AgentRuntimeAdapter): Promise<string> {
    const { runtime, restartPolicy, address } = this.hosts.for(inst.hostId);
    const existing = await this.existingContainerId(inst);
    if (existing && (await adapter.isOnCurrentImage(existing))) return existing;
    // Left by an orchestrator on the previous image (a crash mid-provision): its volume needs the
    // migration too, and the container itself cannot take this config.
    if (existing) {
      await runtime.remove(existing);
      await adapter.prepareState(inst);
    }

    await runtime.ensureVolumeExists(adapter.stateVolumeName(inst.id));
    const options = { ...(await adapter.buildContainerOptions(inst)), restartPolicy, bindIp: address ?? "127.0.0.1" };
    return runtime.create(withTenantCa(options, this.appConfig.tenantCaCertPath));
  }

  private async ensureContainerStarted(inst: Instance, containerId: string): Promise<void> {
    const { runtime } = this.hosts.for(inst.hostId);
    if (await runtime.isRunning(containerId)) return;
    await runtime.start(containerId);
  }

  private async restoreAgentBackup(
    inst: Instance,
    containerId: string,
  ): Promise<void> {
    const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);
    const backup = inst.backupImport;
    if (!backup.objectName) throw new InvalidBackupError("backup object is missing");
    if (!this.backupRestoreStorage) {
      throw new UpstreamUnavailableError("backup storage");
    }

    let source: Awaited<
      ReturnType<AgentBackupRestoreStorage["openObjectStream"]>
    >;
    try {
      source = await this.backupRestoreStorage.openObjectStream(
        backup.objectName,
        adapter.maxBackupBytes,
      );
    } catch (err) {
      throw new InvalidBackupError(errorMessage(err));
    }
    if (
      backup.contentLength !== null &&
      source.contentLength !== backup.contentLength
    ) {
      source.body.destroy();
      throw new InvalidBackupError("backup archive size changed");
    }
    if (
      backup.contentType &&
      source.contentType &&
      source.contentType !== backup.contentType
    ) {
      source.body.destroy();
      throw new InvalidBackupError("backup content type changed");
    }
    try {
      await adapter.restoreState(containerId, source.body);
    } catch (err) {
      source.body.destroy();
      throw new InvalidBackupError(errorMessage(err));
    }
    // The archive may predate the image: migrate it, then put our fields and guidance back on top.
    // Failures here are the host's, not the archive's, so they keep their own error class.
    await adapter.prepareState(inst);
    await this.refreshRuntimeConfig({ ...inst, containerId });
    await this.seedWorkspace(inst, containerId);
    await this.repo.updateBackupImport(inst.id, { status: "restored" });
    await this.backupRestoreStorage
      .deleteObject(backup.objectName)
      .catch((err) =>
        this.logger.warn(
          { instanceId: inst.id, err },
          "backup import object cleanup failed",
        ),
      );
  }

  // As restoreAgentBackup: import into the never-started container, migrate to this image, put our fields and guidance back on top.
  private async restoreMovedVolume(inst: Instance, containerId: string, objectName: string): Promise<void> {
    if (!this.moveStorage) throw new FeatureUnavailableError("moves");
    const adapter = this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind);
    const source = await this.moveStorage.openObjectStream(objectName, MOVE_MAX_BYTES);
    try {
      await adapter.importVolume(containerId, source.body, AbortSignal.timeout(MOVE_STREAM_TIMEOUT_MS));
    } catch (err) {
      source.body.destroy();
      throw err;
    }
    await adapter.prepareState(inst);
    await this.refreshRuntimeConfig({ ...inst, containerId });
    await this.seedWorkspace(inst, containerId);
  }

  // The old host keeps the volume, and any container left under the name, for the retention window as the rollback.
  async purgeMovedSources(): Promise<void> {
    const cutoff = Date.now() - MOVE_SOURCE_RETENTION_MS;
    for (const due of await this.repo.findMovedSourcesDue(MOVE_SOURCE_RETENTION_MS)) {
      if (this.isOperating(due.id)) continue;
      try {
        await this.operationLock.run(due.id, () => this.purgeMovedSourceLocked(due.id, cutoff));
      } catch (err) {
        this.logger.warn(
          { instanceId: due.id, hostId: due.movedFromHostId, err: errorMessage(err) },
          "moved source purge failed",
        );
      }
    }
  }

  // Re-read under the lock: a move that landed meanwhile holds a fresh reference this must not clear.
  private async purgeMovedSourceLocked(id: string, cutoff: number): Promise<void> {
    const inst = await this.repo.findById(id);
    if (!inst?.movedFromHostId || !inst.movedAt || inst.movedAt.getTime() >= cutoff) return;
    if (inst.movedFromHostId === inst.hostId) return;
    // A destroyed row has nothing left to roll back to; every other unfinished move keeps its old copy.
    if (inst.status !== "destroyed" && (inst.status === "provisioning" || inst.moveObjectName !== null)) return;
    const host = this.hosts.for(inst.movedFromHostId);
    if (!(await host.gate.check())) return;
    await this.removeBotFromHost(host, inst);
    // Only a destroyed row still carries an object here: the deleted bot's archive goes with its volume.
    if (inst.moveObjectName) {
      await this.moveStorage
        ?.deleteObject(inst.moveObjectName)
        .catch((err) => this.logger.warn({ instanceId: inst.id, err }, "move object cleanup failed"));
    }
    await this.repo.clearMove(inst.id);
    this.logger.info({ instanceId: inst.id, hostId: inst.movedFromHostId }, "moved source purged");
  }

  private async resolveContainerId(inst: Instance): Promise<string | null> {
    const { runtime } = this.hosts.for(inst.hostId);
    if (inst.containerId && (await runtime.containerState(inst.containerId))) return inst.containerId;
    const byName = await runtime.findContainerByName(inst.containerName);
    if (byName) await this.repo.updateContainerId(inst.id, byName);
    return byName;
  }

  private async resolveExportContainerId(
    inst: Instance,
  ): Promise<string> {
    const containerId = await this.resolveContainerId(inst);
    if (!containerId) {
      throw new InvalidStateError(inst.status, "export_backup");
    }
    return containerId;
  }

  // Restarting mid-first-boot leaves OpenClaw's startup-migration lock behind (5-minute lease) and
  // crash-loops the container, so let the start-up window finish first; an unhealthy one restarts at once.
  private async restartContainer(inst: Instance, containerId: string): Promise<void> {
    const { runtime } = this.hosts.for(inst.hostId);
    await runtime.waitForHealthy(containerId, STARTUP_SETTLE_MS);
    await runtime.restart(containerId);
  }

  private async refreshRuntimeConfig(inst: Instance): Promise<void> {
    if (!inst.containerId) return;
    await this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind).writeConfig(inst.containerId, inst);
  }

  private async cleanupPartial(inst: Instance): Promise<void> {
    try {
      await this.removeBotFromHost(this.hosts.for(inst.hostId), inst);
    } catch {
      // best-effort cleanup
    }
  }

  // Container first: Docker refuses to remove a volume a container still references.
  private async removeBotFromHost(host: HostRuntime, inst: Instance): Promise<void> {
    const containerId = await host.runtime.findContainerByName(inst.containerName);
    if (containerId) await host.runtime.remove(containerId);
    await host.runtime.removeVolume(host.adapters.get(inst.runtimeKind).stateVolumeName(inst.id));
  }

  private async requireInstance(id: string): Promise<Instance> {
    const inst = await this.repo.findById(id);
    if (!inst || inst.status === "destroyed") {
      throw new NotFoundError("instance", id);
    }
    return inst;
  }

  private async requireOwnedInstance(
    id: string,
    userId: string,
  ): Promise<Instance> {
    const inst = await this.requireInstance(id);
    if (inst.userId !== userId) {
      throw new NotFoundError("instance", id);
    }
    return inst;
  }

  private assertTransition(from: InstanceStatus, to: InstanceStatus): void {
    if (!isValidTransition(from, to)) {
      throw new InvalidStateError(from, to);
    }
  }

  private validateUserId(userId: string): void {
    if (!USER_ID_PATTERN.test(userId)) {
      throw new Error("invalid user ID format");
    }
  }

}

// Destroy-time hook only; anything needing updateConfig would deadlock on the instance lock.
export interface IntegrationCleanup {
  revokeAll(instance: Instance): Promise<void>;
}

function integrationsAfterPatch(
  current: InstanceConfig,
  patch: ConfigPatch,
): Pick<InstanceConfig, "integrations"> {
  if (patch.integrations === undefined) {
    return current.integrations ? { integrations: current.integrations } : {};
  }
  return patch.integrations ? { integrations: patch.integrations } : {};
}

function keepOrchestratorChannels(current: ChannelConfig[], patch: ConfigPatch): ConfigPatch {
  if (!patch.channels) return patch;
  const owned = current.filter((ch) => ch.type === "whatsapp_cloud");
  return { ...patch, channels: [...patch.channels.filter((ch) => ch.type !== "whatsapp_cloud"), ...owned] };
}

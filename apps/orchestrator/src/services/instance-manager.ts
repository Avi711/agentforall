import { randomBytes, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { PortAllocator } from "./port-allocator.js";
import type { EventRepository, ProvisioningEvent } from "../storage/event-repository.js";
import type { PairingManager } from "./pairing-manager.js";
import type { AppConfig } from "../config.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
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
} from "../domain/channels.js";
import { relayBindingFor } from "./integrations/relay-binding.js";

export interface AgentBackupRestoreStorage {
  openObjectStream(
    objectName: string,
    maxBytes: number,
  ): Promise<{ body: Readable; contentLength: number; contentType: string | null }>;
  deleteObject(objectName: string): Promise<void>;
}

export interface AgentBackupStream {
  stdout: Readable;
  contentLength: number;
  done: Promise<void>;
}

// Docker's healthcheck StartPeriod is 90s; give a booting container that long plus slack before restarting it.
const STARTUP_SETTLE_MS = 120_000;

export interface InstanceDetails extends Instance {
  provisioningStage: ProvisioningStage | null;
  provisioningHistory: ProvisioningEvent[];
}

export class InstanceManager {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly runtimes: AgentRuntimeRegistry,
    private readonly portAllocator: PortAllocator,
    private readonly appConfig: AppConfig,
    private readonly eventLog: EventRepository,
    private readonly pairingManager: PairingManager,
    private readonly llmKeys: LlmKeyProvisioner,
    private readonly logger: FastifyBaseLogger,
    private readonly backupRestoreStorage: AgentBackupRestoreStorage | null = null,
    private readonly operationLock = new InstanceOperationLock(),
    private readonly telegramApi: TelegramBotApi | null = null,
    private readonly integrationCleanup: IntegrationCleanup | null = null,
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

      // Restore into the not-yet-started container: one boot, no restart mid-migration.
      if (inst.backupImport.status === "pending") {
        await this.restoreAgentBackup(inst, containerId);
        await this.eventLog.append(id, "provision.backup_restored");
      }

      await this.ensureContainerStarted(containerId);
      await this.eventLog.append(id, "provision.started");

      // "running" means the gateway answered its health check, not merely that the process exists.
      // If it never does, promote anyway so the health monitor owns it from here.
      if (!(await this.runtime.waitForHealthy(containerId, STARTUP_SETTLE_MS))) {
        this.logger.warn({ instanceId: id }, "gateway not healthy after start-up window");
      }

      const promoted = await this.repo.updateStatus(id, "running", {
        expectedStatus: "provisioning",
      });
      if (promoted) {
        await this.eventLog.append(id, "provision.running");
        this.logger.info({ instanceId: id }, "instance provisioned");
      }

      return await this.requireInstance(id);
    } catch (err) {
      this.logger.error({ instanceId: id, err }, "provisioning failed");
      await this.repo.updateStatus(id, "error", {
        errorMessage: errorMessage(err),
      });
      await this.eventLog.append(id, "provision.failed", {
        payload: { error: errorMessage(err) },
      });
      await this.cleanupPartial(inst);
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
      if (inst.hasWhatsappCreds) {
        await this.injectWhatsappCreds(id, containerId);
      }
      await this.runtime.start(containerId);
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
    return this.operationLock.run(id, () => this.restartLocked(id, userId));
  }

  private async restartLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    if (!["running", "degraded", "unhealthy"].includes(inst.status)) {
      throw new InvalidStateError(inst.status, "running");
    }
    if (!inst.containerId) {
      throw new InvalidStateError(inst.status, "running");
    }

    try {
      const { containerId, rebuilt } = await this.containerForBoot(inst);
      if (inst.hasWhatsappCreds) {
        await this.injectWhatsappCreds(id, containerId);
      }
      if (rebuilt) await this.runtime.start(containerId);
      else await this.restartContainer(containerId);
    } catch (err) {
      await this.repo.updateStatus(id, "error", { errorMessage: errorMessage(err) });
      throw err;
    }
    await this.repo.updateStatus(id, "running");
    this.logger.info({ instanceId: id }, "instance restarted");
  }

  // The container to boot: the one under the bot's name (the row can lag a crashed rebuild) when
  // it is on the current image, otherwise a rebuilt one, since another image cannot boot this config.
  private async containerForBoot(inst: Instance): Promise<{ containerId: string; rebuilt: boolean }> {
    const existing = await this.existingContainerId(inst);
    if (existing && (await this.runtimes.get(inst.runtimeKind).isOnCurrentImage(existing))) {
      if (existing !== inst.containerId) await this.repo.updateContainerId(inst.id, existing);
      await this.refreshRuntimeConfig({ ...inst, containerId: existing });
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

  // Rebuilds the container from the currently configured runtime image; state volume persists.
  private async recreateLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    if (!["running", "degraded", "unhealthy", "error"].includes(inst.status)) {
      throw new InvalidStateError(inst.status, "running");
    }

    try {
      const containerId = await this.recreateContainer(inst);
      if (inst.hasWhatsappCreds) {
        await this.injectWhatsappCreds(id, containerId);
      }
      await this.runtime.start(containerId);
      // The migration can outlast the reconciler's patience (row marked stopped or error meanwhile);
      // the container is running now, so the row says so regardless.
      await this.repo.updateStatus(id, "running");
      await this.eventLog.append(id, "instance.recreated", {
        actor: userId,
        payload: { containerId },
      });
      if (!(await this.runtime.waitForHealthy(containerId, STARTUP_SETTLE_MS))) {
        this.logger.warn({ instanceId: id }, "gateway not healthy after recreate");
      }
    } catch (err) {
      await this.repo.updateStatus(id, "error", {
        errorMessage: errorMessage(err),
      });
      throw err;
    }

    this.logger.info({ instanceId: id }, "instance recreated");
  }

  // Stop, migrate the volume, only then remove: a failed migration leaves the bot startable as it was.
  private async recreateContainer(current: Instance): Promise<string> {
    const inst = await this.ensureIntegrationsBinding(current);
    const adapter = this.runtimes.get(inst.runtimeKind);
    const existing = await this.existingContainerId(inst);
    if (existing && (await this.runtime.isRunning(existing))) {
      await this.runtime.stop(existing);
    }
    await adapter.prepareState(inst);
    if (existing) await this.runtime.remove(existing);
    const containerId = await this.ensureContainerExists({ ...inst, containerId: null });
    await this.repo.updateContainerId(inst.id, containerId);
    return containerId;
  }

  // The row's id can be stale after a crash mid-rebuild; the name is the durable handle.
  private async existingContainerId(inst: Instance): Promise<string | null> {
    if (inst.containerId && (await this.runtime.inspect(inst.containerId))) return inst.containerId;
    return this.runtime.findContainerByName(inst.containerName);
  }

  // Best effort: guidance missing from a workspace is a support ticket, not a broken bot.
  private async seedWorkspace(inst: Instance, containerId: string): Promise<void> {
    try {
      await this.runtimes.get(inst.runtimeKind).seedWorkspace(containerId);
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "workspace guidance seed failed");
    }
  }

  private async ensureIntegrationsBinding(inst: Instance): Promise<Instance> {
    if (inst.config.integrations) return inst;
    const binding = this.newIntegrationsBinding(inst.id);
    if (!binding) return inst;
    const config: InstanceConfig = { ...inst.config, integrations: binding };
    await this.repo.updateConfig(inst.id, config);
    return { ...inst, config };
  }

  private newIntegrationsBinding(instanceId: string): InstanceConfig["integrations"] {
    if (!this.appConfig.integrationsProvider) return undefined;
    return relayBindingFor(instanceId, this.appConfig.orchestratorInternalUrl);
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
      await this.runtime.stop(inst.containerId);
    } catch (err) {
      await this.repo.updateStatus(id, inst.status, {
        expectedStatus: "stopped",
      });
      throw err;
    }

    this.logger.info({ instanceId: id }, "instance stopped");
  }

  async destroy(id: string, userId: string): Promise<void> {
    return this.operationLock.run(id, () => this.destroyLocked(id, userId));
  }

  private async destroyLocked(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    if (inst.status === "destroyed") return;

    // `error` already released the gateway port; re-entering `destroying` would
    // re-claim it and can collide with a newer instance, so clean up from `error` directly.
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
      whatsappCreds: null,
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
      if (inst.containerId) {
        await this.runtime.remove(inst.containerId);
      }
      await this.runtime.removeVolume(
        this.runtimes.get(inst.runtimeKind).stateVolumeName(inst.id),
      );
      await this.repo.updateStatus(id, "destroyed");
      this.logger.info({ instanceId: id }, "instance destroyed");
    } catch (err) {
      this.logger.error({ instanceId: id, err }, "destroy failed");
      await this.repo.updateStatus(id, "error", { errorMessage: errorMessage(err) });
      throw err;
    }
  }

  async updateConfig(
    id: string,
    userId: string,
    patch: ConfigPatch,
  ): Promise<Instance> {
    return this.operationLock.run(id, () =>
      this.updateConfigLocked(id, userId, patch),
    );
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
    const adapter = inst.containerId ? this.runtimes.get(inst.runtimeKind) : null;
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
      (await this.runtime.isRunning(inst.containerId))
    ) {
      await this.restartContainer(inst.containerId);
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

  // Adds the WhatsApp channel to bots created Telegram-first so pairing has a channel to land in.
  async ensureWhatsappChannel(id: string, userId: string): Promise<Instance> {
    const { instance } = await this.updateChannels(id, userId, (channels) =>
      findWhatsappChannel(channels)
        ? channels
        : applyChannelDefaults([...channels, { type: "whatsapp" }]),
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
        whatsappCreds: null,
        whatsappAccountId: null,
        pairingStatus: "none",
      });
      await this.eventLog.append(id, "whatsapp.disconnected", { actor: userId });

      // Restart so the runtime drops its in-memory socket; start() won't re-inject creds anymore.
      if (inst.containerId && containerUp) {
        await this.restartContainer(inst.containerId);
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
    const adapter = this.runtimes.get(inst.runtimeKind);

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
      const containerName = this.runtimes.get(runtimeKind).containerName(id);
      const gatewayToken = randomBytes(32).toString("hex");
      const gatewayPort = await this.portAllocator.allocate();
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
        const integrations = this.newIntegrationsBinding(id);
        const config: InstanceConfig = {
          displayName: input.displayName,
          provider,
          channels: input.channels,
          resources: {
            memoryMb: input.resources?.memoryMb ?? DEFAULT_RESOURCE_LIMITS.memoryMb,
            cpuShares:
              input.resources?.cpuShares ?? DEFAULT_RESOURCE_LIMITS.cpuShares,
          },
          ...(integrations ? { integrations } : {}),
        };
        const inserted = await this.repo.insertIfUserActiveBelowLimit(
          {
            id,
            userId,
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
    const adapter = this.runtimes.get(inst.runtimeKind);
    const containerId = await this.findOrCreateContainer(inst, adapter);
    await adapter.writeConfig(containerId, { ...inst, containerId });
    await this.seedWorkspace(inst, containerId);
    return containerId;
  }

  private async findOrCreateContainer(inst: Instance, adapter: AgentRuntimeAdapter): Promise<string> {
    const existing = await this.existingContainerId(inst);
    if (existing && (await adapter.isOnCurrentImage(existing))) return existing;
    // Left by an orchestrator on the previous image (a crash mid-provision): its volume needs the
    // migration too, and the container itself cannot take this config.
    if (existing) {
      await this.runtime.remove(existing);
      await adapter.prepareState(inst);
    }

    await this.runtime.ensureVolumeExists(adapter.stateVolumeName(inst.id));
    return this.runtime.create(await adapter.buildContainerOptions(inst));
  }

  private async ensureContainerStarted(containerId: string): Promise<void> {
    if (await this.runtime.isRunning(containerId)) return;
    await this.runtime.start(containerId);
  }

  private async restoreAgentBackup(
    inst: Instance,
    containerId: string,
  ): Promise<void> {
    const adapter = this.runtimes.get(inst.runtimeKind);
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

  private async resolveContainerId(inst: Instance): Promise<string | null> {
    if (inst.containerId) {
      const current = await this.runtime.inspect(inst.containerId);
      if (current) return inst.containerId;
    }
    const byName = await this.runtime.findContainerByName(inst.containerName);
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
  private async restartContainer(containerId: string): Promise<void> {
    await this.runtime.waitForHealthy(containerId, STARTUP_SETTLE_MS);
    await this.runtime.restart(containerId);
  }

  private async refreshRuntimeConfig(inst: Instance): Promise<void> {
    if (!inst.containerId) return;
    await this.runtimes.get(inst.runtimeKind).writeConfig(inst.containerId, inst);
  }

  private async injectWhatsappCreds(
    instanceId: string,
    containerId: string,
  ): Promise<void> {
    const creds = await this.repo.getDecryptedWhatsappCreds(instanceId);
    if (!creds) return;
    const inst = await this.requireInstance(instanceId);
    await this.runtimes.get(inst.runtimeKind).injectWhatsappSession(containerId, creds);
  }

  private async cleanupPartial(inst: Instance): Promise<void> {
    try {
      const id = await this.runtime.findContainerByName(inst.containerName);
      if (id) {
        await this.runtime.remove(id);
      }
      await this.runtime.removeVolume(
        this.runtimes.get(inst.runtimeKind).stateVolumeName(inst.id),
      );
    } catch {
      // best-effort cleanup
    }
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

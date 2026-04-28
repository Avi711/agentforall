import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { ConfigGenerator } from "./config-generator.js";
import type { PortAllocator } from "./port-allocator.js";
import type { EventRepository } from "../storage/event-repository.js";
import type { PairingManager } from "./pairing-manager.js";
import type { AppConfig } from "../config.js";
import {
  NotFoundError,
  InvalidStateError,
  QuotaExceededError,
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
} from "../domain/types.js";
import {
  WHATSAPP_SESSION_DIR,
  WHATSAPP_SESSION_PARENT,
} from "../domain/constants.js";

export class InstanceManager {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly configGen: ConfigGenerator,
    private readonly portAllocator: PortAllocator,
    private readonly appConfig: AppConfig,
    private readonly eventLog: EventRepository,
    private readonly pairingManager: PairingManager,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async create(userId: string, input: CreateInstanceInput): Promise<Instance> {
    this.validateUserId(userId);

    const activeCount = await this.repo.countByUserId(userId);
    if (activeCount >= this.appConfig.maxInstancesPerUser) {
      throw new QuotaExceededError("instances", this.appConfig.maxInstancesPerUser);
    }

    const provider = input.provider ?? this.resolveDefaultProvider();
    const config: InstanceConfig = {
      displayName: input.displayName,
      provider,
      channels: input.channels,
      resources: {
        memoryMb: input.resources?.memoryMb ?? DEFAULT_RESOURCE_LIMITS.memoryMb,
        cpuShares:
          input.resources?.cpuShares ?? DEFAULT_RESOURCE_LIMITS.cpuShares,
      },
    };

    const reserved = await this.reserveIdentity(userId, config);
    await this.eventLog.append(reserved.id, "provision.requested", {
      actor: userId,
    });

    return this.resumeProvisioning(reserved.id);
  }

  // Idempotent — reconciler calls this to recover from mid-provision crashes.
  async resumeProvisioning(id: string): Promise<Instance> {
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

      await this.ensureContainerStarted(containerId);
      await this.eventLog.append(id, "provision.started");

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
      await this.cleanupPartial(inst.containerName);
      throw err;
    }
  }

  async get(id: string, userId: string): Promise<Instance> {
    return this.requireOwnedInstance(id, userId);
  }

  async list(
    userId: string,
    cursor?: { createdAt: Date; id: string },
    limit?: number,
  ): Promise<Instance[]> {
    return this.repo.findByUserId(userId, cursor, limit);
  }

  async start(id: string, userId: string): Promise<void> {
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
      if (inst.hasWhatsappCreds) {
        await this.injectWhatsappCreds(id, inst.containerId);
      }
      await this.runtime.start(inst.containerId);
    } catch (err) {
      await this.repo.updateStatus(id, inst.status);
      throw err;
    }

    this.logger.info({ instanceId: id }, "instance started");
  }

  async stop(id: string, userId: string): Promise<void> {
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
      await this.repo.updateStatus(id, inst.status);
      throw err;
    }

    this.logger.info({ instanceId: id }, "instance stopped");
  }

  async destroy(id: string, userId: string): Promise<void> {
    const inst = await this.requireOwnedInstance(id, userId);
    this.assertTransition(inst.status, "destroying");

    const updated = await this.repo.updateStatus(id, "destroying", {
      expectedStatus: inst.status,
    });
    if (!updated) throw new InvalidStateError(inst.status, "destroying");

    // Tell WhatsApp to drop the linked-device entry while the main container
    // is still alive — uses OpenClaw's own CLI via `docker exec`.
    if (inst.hasWhatsappCreds && inst.containerId) {
      await this.pairingManager.logoutWhatsapp(id, inst.containerId);
    }

    // Wipe creds so a failed container removal still honors "delete everything".
    await this.repo.updatePairing(id, {
      whatsappCreds: null,
      whatsappAccountId: null,
      pairingStatus: "none",
    });

    // Tear down sidecar before main container so a mid-pair destroy doesn't leak a Baileys socket.
    await this.pairingManager.teardownSidecar(id, "destroy");

    try {
      if (inst.containerId) {
        await this.runtime.remove(inst.containerId);
      }
      await this.repo.updateStatus(id, "destroyed");
      this.logger.info({ instanceId: id }, "instance destroyed");
    } catch (err) {
      this.logger.error({ instanceId: id, err }, "destroy failed");
      await this.repo.updateStatus(id, "error", {
        errorMessage: errorMessage(err),
      });
      throw err;
    }
  }

  async updateConfig(
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
    };

    await this.repo.updateConfig(id, merged);

    // putArchive works on stopped containers too; only restart if currently running.
    if (inst.containerId) {
      const openclawJson = this.configGen.generateOpenclawConfig(
        merged,
        inst.gatewayToken,
      );
      const dotEnv = this.configGen.generateEnvFile(merged, inst.gatewayToken);
      await this.runtime.injectConfig(inst.containerId, openclawJson, dotEnv);
      if (["running", "degraded", "unhealthy"].includes(inst.status)) {
        await this.runtime.restart(inst.containerId);
      }
    }

    return this.requireOwnedInstance(id, userId);
  }

  // Retry on port-allocation race; container creation happens later in resumeProvisioning.
  private async reserveIdentity(
    userId: string,
    config: InstanceConfig,
  ): Promise<Instance> {
    let lastError: Error | null = null;

    for (
      let attempt = 0;
      attempt < this.appConfig.maxProvisionRetries;
      attempt++
    ) {
      const id = randomUUID();
      const shortId = id.slice(0, 12);
      const containerName = `openclaw-${shortId}`;
      const gatewayToken = randomBytes(32).toString("hex");
      const gatewayPort = await this.portAllocator.allocate();

      try {
        return await this.repo.insert({
          id,
          userId,
          displayName: config.displayName,
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
        });
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isUniqueViolation(err)) {
          this.logger.warn(
            { port: gatewayPort, attempt },
            "port conflict — retrying with new identity",
          );
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("failed to reserve instance identity");
  }

  private async ensureContainerExists(inst: Instance): Promise<string> {
    if (inst.containerId) {
      const info = await this.runtime.inspect(inst.containerId);
      if (info) return inst.containerId;
    }

    const byName = await this.runtime.findContainerByName(inst.containerName);
    if (byName) return byName;

    const openclawJson = this.configGen.generateOpenclawConfig(
      inst.config,
      inst.gatewayToken,
    );
    const dotEnv = this.configGen.generateEnvFile(
      inst.config,
      inst.gatewayToken,
    );

    return this.runtime.create({
      name: inst.containerName,
      image: this.appConfig.openclawImage,
      hostPort: inst.gatewayPort,
      envVars: ["OPENCLAW_HEADLESS=true"],
      memoryBytes: inst.config.resources.memoryMb * 1024 * 1024,
      cpuShares: inst.config.resources.cpuShares,
      openclawConfig: openclawJson,
      dotEnv,
      labels: {
        "agent-forall.instance-id": inst.id,
        "agent-forall.user-id": inst.userId,
      },
    });
  }

  private async ensureContainerStarted(containerId: string): Promise<void> {
    if (await this.runtime.isRunning(containerId)) return;
    await this.runtime.start(containerId);
  }

  private async injectWhatsappCreds(
    instanceId: string,
    containerId: string,
  ): Promise<void> {
    const creds = await this.repo.getDecryptedWhatsappCreds(instanceId);
    if (!creds) return;
    await this.runtime.putArchiveUnderDir(
      containerId,
      WHATSAPP_SESSION_PARENT,
      WHATSAPP_SESSION_DIR,
      creds,
    );
  }

  private async cleanupPartial(containerName: string): Promise<void> {
    try {
      const id = await this.runtime.findContainerByName(containerName);
      if (id) {
        await this.runtime.remove(id);
      }
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

  private resolveDefaultProvider() {
    const apiKey = this.appConfig.defaultProviderApiKey;
    if (!apiKey) {
      throw new Error(
        "no provider supplied and DEFAULT_PROVIDER_API_KEY is not configured",
      );
    }
    return {
      name: this.appConfig.defaultProviderName,
      apiKey,
      model: this.appConfig.defaultProviderModel,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

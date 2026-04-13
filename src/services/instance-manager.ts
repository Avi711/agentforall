import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { ContainerRuntime } from "./container-runtime.js";
import type { ConfigGenerator } from "./config-generator.js";
import type { PortAllocator } from "./port-allocator.js";
import type { AppConfig } from "../config.js";
import {
  NotFoundError,
  InvalidStateError,
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

export class InstanceManager {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly runtime: ContainerRuntime,
    private readonly configGen: ConfigGenerator,
    private readonly portAllocator: PortAllocator,
    private readonly appConfig: AppConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async create(userId: string, input: CreateInstanceInput): Promise<Instance> {
    this.validateUserId(userId);

    const activeCount = await this.repo.countByUserId(userId);
    if (activeCount >= this.appConfig.maxInstancesPerUser) {
      throw new InvalidStateError(
        `limit of ${this.appConfig.maxInstancesPerUser} instances`,
        "exceeded",
      );
    }

    const config: InstanceConfig = {
      ...input,
      resources: {
        memoryMb: input.resources?.memoryMb ?? DEFAULT_RESOURCE_LIMITS.memoryMb,
        cpuShares:
          input.resources?.cpuShares ?? DEFAULT_RESOURCE_LIMITS.cpuShares,
      },
    };

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
        return await this.provision(
          id,
          userId,
          containerName,
          gatewayToken,
          gatewayPort,
          config,
        );
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

    throw lastError!;
  }

  async get(id: string, userId: string): Promise<Instance> {
    return this.requireOwnedInstance(id, userId);
  }

  async list(
    userId: string,
    cursor?: Date,
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

    if (
      inst.containerId &&
      ["running", "degraded", "unhealthy"].includes(inst.status)
    ) {
      if (inst.gatewayToken === "[corrupted]") {
        throw new Error(
          `cannot update config for instance '${id}': gateway token is corrupted`,
        );
      }
      const openclawJson = this.configGen.generateOpenclawConfig(
        merged,
        inst.gatewayToken,
      );
      const dotEnv = this.configGen.generateEnvFile(merged, inst.gatewayToken);
      await this.runtime.injectConfig(inst.containerId, openclawJson, dotEnv);
      await this.runtime.restart(inst.containerId);
    }

    return this.requireOwnedInstance(id, userId);
  }

  private async provision(
    id: string,
    userId: string,
    containerName: string,
    gatewayToken: string,
    gatewayPort: number,
    config: InstanceConfig,
  ): Promise<Instance> {
    const openclawJson = this.configGen.generateOpenclawConfig(
      config,
      gatewayToken,
    );
    const dotEnv = this.configGen.generateEnvFile(config, gatewayToken);

    const instance = await this.repo.insert({
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

    try {
      const containerId = await this.runtime.create({
        name: containerName,
        image: this.appConfig.openclawImage,
        hostPort: gatewayPort,
        envVars: ["OPENCLAW_HEADLESS=true"],
        memoryBytes: config.resources.memoryMb * 1024 * 1024,
        cpuShares: config.resources.cpuShares,
        openclawConfig: openclawJson,
        dotEnv,
        labels: {
          "agent-forall.instance-id": id,
          "agent-forall.user-id": userId,
        },
      });

      await this.repo.updateContainerId(id, containerId);
      await this.runtime.start(containerId);
      await this.repo.updateStatus(id, "running");

      this.logger.info(
        { instanceId: id, port: gatewayPort },
        "instance provisioned",
      );

      return { ...instance, status: "running", containerId };
    } catch (err) {
      this.logger.error({ instanceId: id, err }, "provisioning failed");
      await this.repo.updateStatus(id, "error", {
        errorMessage: errorMessage(err),
      });
      await this.cleanupPartial(containerName);
      throw err;
    }
  }

  private async cleanupPartial(containerName: string): Promise<void> {
    try {
      const containers = await this.runtime.listManagedContainers();
      const found = containers.find((c) =>
        c.Names.some((n) => n === `/${containerName}`),
      );
      if (found) {
        await this.runtime.remove(found.Id);
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
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

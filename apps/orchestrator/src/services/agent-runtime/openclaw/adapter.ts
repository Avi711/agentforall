import type { Readable } from "node:stream";
import type { ContainerArchiveFile } from "../../container-runtime.js";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { Instance, InstanceConfig } from "../../../domain/types.js";
import type {
  AgentRuntimeAdapter,
  RuntimeConfigFiles,
  RuntimeHealthResult,
  WhatsappPairingRequest,
} from "../types.js";
import {
  OPENCLAW_BACKUP_TIMEOUT_MS,
  buildOpenclawBackupFileCommand,
  parseOpenclawArchiveFile,
  rewrapOpenclawStateTarGzip,
} from "./backup.js";
import {
  buildOpenclawConfigTar,
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
  openclawReadConfigCommand,
  readOwnerAllowFrom,
} from "./config.js";
import {
  OPENCLAW_HEALTH_PATH,
  OPENCLAW_INTERNAL_PORT,
  OPENCLAW_MAX_BACKUP_BYTES,
  OPENCLAW_STATE_PARENT,
  OPENCLAW_STATE_ROOT,
} from "./constants.js";
import { probeOpenclaw } from "./health.js";
import {
  injectOpenclawWhatsappSession,
  listOpenclawWhatsappPairingRequests,
  logoutOpenclawWhatsapp,
} from "./whatsapp.js";

export class OpenClawRuntimeAdapter implements AgentRuntimeAdapter {
  readonly kind = "openclaw" as const;
  readonly maxBackupBytes = OPENCLAW_MAX_BACKUP_BYTES;
  // The gateway watches openclaw.json (gateway.reload.mode=hybrid) and hot-applies channels/session/agents.
  readonly hotReloadsConfig = true;

  constructor(
    private readonly runtime: ContainerRuntime,
    readonly image: string,
  ) {}

  containerName(instanceId: string): string {
    return `openclaw-${instanceId.slice(0, 12)}`;
  }

  stateVolumeName(instanceId: string): string {
    return `oc-${instanceId.slice(0, 12)}-state`;
  }

  async buildContainerOptions(instance: Instance) {
    const files = this.generateConfig(instance.config, instance.gatewayToken);
    return {
      name: instance.containerName,
      image: this.image,
      internalPort: OPENCLAW_INTERNAL_PORT,
      healthPath: OPENCLAW_HEALTH_PATH,
      hostPort: instance.gatewayPort,
      envVars: ["OPENCLAW_HEADLESS=true"],
      memoryBytes: instance.config.resources.memoryMb * 1024 * 1024,
      cpuShares: instance.config.resources.cpuShares,
      labels: {
        "agent-forall.instance-id": instance.id,
        "agent-forall.user-id": instance.userId,
        "agent-forall.runtime": this.kind,
      },
      volumeMounts: [
        {
          name: this.stateVolumeName(instance.id),
          containerPath: OPENCLAW_STATE_ROOT,
        },
      ],
      shmSizeBytes: 2 * 1024 * 1024 * 1024,
      initialArchive: {
        targetPath: OPENCLAW_STATE_PARENT,
        content: await buildOpenclawConfigTar(files),
      },
    };
  }

  generateConfig(
    config: InstanceConfig,
    gatewayToken: string,
  ): RuntimeConfigFiles {
    return generateOpenclawFiles(config, gatewayToken);
  }

  // Writes the file; the gateway's own hot reload applies it. A stopped or crash-looping container
  // can't be read (exec is refused), so it gets a freshly generated file instead — putArchive works either way.
  async refreshConfig(containerId: string, instance: Instance): Promise<void> {
    const existing = (await this.runtime.isRunning(containerId))
      ? await this.tryReadConfig(containerId)
      : null;
    const files =
      existing === null
        ? generateOpenclawFiles(instance.config, instance.gatewayToken)
        : generateRuntimePatchedOpenclawFiles(existing, instance.config, instance.gatewayToken);
    await this.runtime.putArchive(
      containerId,
      OPENCLAW_STATE_PARENT,
      await buildOpenclawConfigTar(files),
    );
  }

  private async tryReadConfig(containerId: string): Promise<string | null> {
    try {
      return await this.readConfig(containerId);
    } catch {
      // Docker refuses exec while a container is restarting; the fresh file is the safe fallback.
      return null;
    }
  }

  injectWhatsappSession(
    containerId: string,
    credsTar: Buffer,
  ): Promise<void> {
    return injectOpenclawWhatsappSession(this.runtime, containerId, credsTar);
  }

  async exportState(containerId: string) {
    const archive = await this.createStateArchiveFile(containerId);
    const stream = await this.runtime.streamFile(
      containerId,
      archive.path,
      OPENCLAW_BACKUP_TIMEOUT_MS,
    );
    return {
      stdout: stream.stdout,
      contentLength: archive.sizeBytes,
      done: stream.done.finally(async () => {
        await this.runtime.removeFile(containerId, archive.path);
      }),
    };
  }

  restoreState(containerId: string, sourceTarGzip: Readable): Promise<void> {
    return this.runtime.putArchive(
      containerId,
      OPENCLAW_STATE_PARENT,
      rewrapOpenclawStateTarGzip(sourceTarGzip),
    );
  }

  probe(
    instance: Instance,
    timeoutMs: number,
    useDockerNetwork: boolean,
  ): Promise<RuntimeHealthResult> {
    return probeOpenclaw(
      this.runtime,
      instance,
      timeoutMs,
      useDockerNetwork,
    );
  }

  logoutWhatsapp(containerId: string): Promise<boolean> {
    return logoutOpenclawWhatsapp(this.runtime, containerId);
  }

  listWhatsappPairingRequests(containerId: string): Promise<WhatsappPairingRequest[]> {
    return listOpenclawWhatsappPairingRequests(this.runtime, containerId);
  }

  async readOwnerIds(containerId: string): Promise<string[]> {
    return readOwnerAllowFrom(await this.readConfig(containerId));
  }

  private async readConfig(containerId: string): Promise<string> {
    const result = await this.runtime.execCommandBuffer(
      containerId,
      openclawReadConfigCommand(),
      15_000,
      1024 * 1024,
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "openclaw config read failed");
    }
    return result.stdout.toString("utf8");
  }

  private async createStateArchiveFile(
    containerId: string,
  ): Promise<ContainerArchiveFile> {
    const result = await this.runtime.execCommandWithOutput(
      containerId,
      ["sh", "-c", buildOpenclawBackupFileCommand()],
      OPENCLAW_BACKUP_TIMEOUT_MS,
    );
    if (result.exitCode !== 0) {
      throw new Error(`openclaw backup failed: ${result.stderr || result.exitCode}`);
    }
    return parseOpenclawArchiveFile(result.stdout);
  }
}

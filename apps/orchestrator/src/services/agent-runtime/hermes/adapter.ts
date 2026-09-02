import type { Readable } from "node:stream";
import type { ContainerArchiveFile } from "../../container-runtime.js";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { Instance, InstanceConfig } from "../../../domain/types.js";
import type {
  AgentRuntimeAdapter,
  ConfigApplyOutcome,
  RuntimeConfigFiles,
  GatewayLiveness,
  WhatsappLinkState,
  WhatsappPairingRequest,
} from "../types.js";
import {
  HERMES_BACKUP_TIMEOUT_MS,
  buildHermesBackupFileCommand,
  parseHermesArchiveFile,
  rewrapHermesStateTarGzip,
} from "./backup.js";
import {
  buildHermesConfigTar,
  generateHermesFiles,
} from "./config.js";
import {
  HERMES_HEALTH_PATH,
  HERMES_INTERNAL_PORT,
  HERMES_MAX_BACKUP_BYTES,
  HERMES_STATE_PARENT,
  HERMES_STATE_ROOT,
} from "./constants.js";
import { probeHermesGateway, probeHermesWhatsapp } from "./health.js";
import {
  injectHermesWhatsappSession,
  logoutHermesWhatsapp,
} from "./whatsapp.js";

export class HermesRuntimeAdapter implements AgentRuntimeAdapter {
  readonly kind = "hermes" as const;
  readonly maxBackupBytes = HERMES_MAX_BACKUP_BYTES;
  // Hermes reads config at boot only.

  constructor(
    private readonly runtime: ContainerRuntime,
    readonly image: string,
  ) {}

  containerName(instanceId: string): string {
    return `hermes-${instanceId.slice(0, 12)}`;
  }

  stateVolumeName(instanceId: string): string {
    return `hm-${instanceId.slice(0, 12)}-state`;
  }

  async buildContainerOptions(instance: Instance) {
    const files = this.generateConfig(instance.config, instance.gatewayToken);
    return {
      name: instance.containerName,
      image: this.image,
      command: ["gateway", "run"],
      internalPort: HERMES_INTERNAL_PORT,
      healthPath: HERMES_HEALTH_PATH,
      hostPort: instance.gatewayPort,
      envVars: [
        "HERMES_UID=10000",
        "HERMES_GID=10000",
        "HERMES_HOME=/opt/data",
        ...parseDotEnv(files.dotEnv),
      ],
      memoryBytes: instance.config.resources.memoryMb * 1024 * 1024,
      cpuShares: instance.config.resources.cpuShares,
      labels: {
        "agent-forall.instance-id": instance.id,
        "agent-forall.user-id": instance.userId,
        "agent-forall.runtime": this.kind,
      },
      capDrop: null,
      capAdd: [],
      securityOpt: null,
      volumeMounts: [
        {
          name: this.stateVolumeName(instance.id),
          containerPath: HERMES_STATE_ROOT,
        },
      ],
      shmSizeBytes: 2 * 1024 * 1024 * 1024,
      initialArchive: {
        targetPath: HERMES_STATE_PARENT,
        content: await buildHermesConfigTar(files),
      },
    };
  }

  generateConfig(
    config: InstanceConfig,
    gatewayToken: string,
  ): RuntimeConfigFiles {
    return generateHermesFiles(config, gatewayToken);
  }

  // Hermes has no live-config channel; a change is only live once the container boots again.
  async applyConfig(containerId: string, instance: Instance): Promise<ConfigApplyOutcome> {
    await this.writeConfig(containerId, instance);
    return "restart_required";
  }

  async writeConfig(containerId: string, instance: Instance): Promise<void> {
    const files = this.generateConfig(instance.config, instance.gatewayToken);
    await this.runtime.putArchive(
      containerId,
      HERMES_STATE_PARENT,
      await buildHermesConfigTar(files),
    );
  }

  injectWhatsappSession(
    containerId: string,
    credsTar: Buffer,
  ): Promise<void> {
    return injectHermesWhatsappSession(this.runtime, containerId, credsTar);
  }

  async exportState(containerId: string) {
    const archive = await this.createStateArchiveFile(containerId);
    const stream = await this.runtime.streamFile(
      containerId,
      archive.path,
      HERMES_BACKUP_TIMEOUT_MS,
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
      HERMES_STATE_PARENT,
      rewrapHermesStateTarGzip(sourceTarGzip),
    );
  }

  probeGateway(
    instance: Instance,
    timeoutMs: number,
    useDockerNetwork: boolean,
  ): Promise<GatewayLiveness> {
    return probeHermesGateway(instance, timeoutMs, useDockerNetwork);
  }

  probeWhatsapp(
    instance: Instance,
    timeoutMs: number,
    useDockerNetwork: boolean,
  ): Promise<WhatsappLinkState> {
    return probeHermesWhatsapp(instance, timeoutMs, useDockerNetwork);
  }

  logoutWhatsapp(containerId: string): Promise<boolean> {
    return logoutHermesWhatsapp(this.runtime, containerId);
  }

  // Hermes has no DM pairing store; owner claim is manual-entry only.
  async listWhatsappPairingRequests(): Promise<WhatsappPairingRequest[]> {
    return [];
  }

  async prepareState(): Promise<void> {}

  async seedWorkspace(): Promise<void> {}

  async isOnCurrentImage(): Promise<boolean> {
    return true;
  }

  // Hermes has no owner concept in its config, so there is nothing to read back.
  async readOwnerIds(): Promise<null> {
    return null;
  }

  private async createStateArchiveFile(
    containerId: string,
  ): Promise<ContainerArchiveFile> {
    const result = await this.runtime.execCommandWithOutput(
      containerId,
      ["sh", "-c", buildHermesBackupFileCommand()],
      HERMES_BACKUP_TIMEOUT_MS,
    );
    if (result.exitCode !== 0) {
      throw new Error(`hermes backup failed: ${result.stderr || result.exitCode}`);
    }
    return parseHermesArchiveFile(result.stdout);
  }
}

function parseDotEnv(dotEnv: string): string[] {
  return dotEnv
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

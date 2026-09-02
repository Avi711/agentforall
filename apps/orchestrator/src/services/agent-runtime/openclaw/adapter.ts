import type { Readable } from "node:stream";
import type { ContainerArchiveFile } from "../../container-runtime.js";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { Instance, InstanceConfig } from "../../../domain/types.js";
import {
  RuntimeImageMismatchError,
  UpstreamUnavailableError,
  ValidationError,
  errorMessage,
} from "../../../domain/errors.js";
import type {
  AgentRuntimeAdapter,
  ConfigApplyOutcome,
  GatewayLiveness,
  RuntimeConfigFiles,
  WhatsappPairingRequest,
  WhatsappLinkState,
  WhatsappLogoutResult,
} from "../types.js";
import {
  OPENCLAW_BACKUP_TIMEOUT_MS,
  buildOpenclawBackupFileCommand,
  parseOpenclawArchiveFile,
  rewrapOpenclawStateTarGzip,
} from "./backup.js";
import {
  buildOpenclawConfigTar,
  buildOpenclawEnvTar,
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
  configMatches,
  readOwnerAllowFrom,
} from "./config.js";
import { prepareOpenclawState, seedOpenclawWorkspace } from "./migrate.js";
import { buildConfigApplyCommand, parseConfigApplyOutput } from "./config-rpc.js";
import type { ConfigApplyResult } from "./config-rpc.js";
import {
  OPENCLAW_CONFIG_APPLY_TIMEOUT_MS,
  OPENCLAW_CONFIG_PATH,
  OPENCLAW_ENV_PATH,
  OPENCLAW_HEALTH_PATH,
  OPENCLAW_INTERNAL_PORT,
  OPENCLAW_MAX_BACKUP_BYTES,
  OPENCLAW_STATE_PARENT,
  OPENCLAW_STATE_ROOT,
} from "./constants.js";
import { probeOpenclawGateway, probeOpenclawWhatsapp } from "./health.js";
import {
  injectOpenclawWhatsappSession,
  listOpenclawWhatsappPairingRequests,
  logoutOpenclawWhatsapp,
} from "./whatsapp.js";

const CONFIG_READ_LIMIT_BYTES = 1024 * 1024;
const ENV_READ_LIMIT_BYTES = 64 * 1024;

export class OpenClawRuntimeAdapter implements AgentRuntimeAdapter {
  readonly kind = "openclaw" as const;
  readonly maxBackupBytes = OPENCLAW_MAX_BACKUP_BYTES;

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

  // No config baked in at create: the volume may already hold one, and writeConfig patches or seeds it.
  async buildContainerOptions(instance: Instance) {
    return {
      name: instance.containerName,
      image: this.image,
      internalPort: OPENCLAW_INTERNAL_PORT,
      healthPath: OPENCLAW_HEALTH_PATH,
      hostPort: instance.gatewayPort,
      envVars: [],
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
    };
  }

  prepareState(instance: Instance): Promise<void> {
    return prepareOpenclawState(this.runtime, {
      image: this.image,
      volumeName: this.stateVolumeName(instance.id),
      containerName: instance.containerName,
    });
  }

  seedWorkspace(containerId: string): Promise<void> {
    return seedOpenclawWorkspace(this.runtime, containerId);
  }

  generateConfig(
    config: InstanceConfig,
    gatewayToken: string,
  ): RuntimeConfigFiles {
    return generateOpenclawFiles(config, gatewayToken);
  }

  // Stages the config for the container's next boot, patching the fields we own onto whatever is
  // there. The pristine config is only ever right for a container that has none — writing it over
  // an existing one would discard the tenant's own settings.
  async writeConfig(containerId: string, instance: Instance): Promise<void> {
    if (!(await this.isOnCurrentImage(containerId))) throw new RuntimeImageMismatchError();
    await this.stageConfig(containerId, instance);
  }

  private async stageConfig(containerId: string, instance: Instance): Promise<void> {
    const existing = await this.readConfig(containerId);
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

  // The gateway validates and applies the change itself and says whether it worked; a file write
  // only says the bytes landed, and nothing restarts a healthy container to make it read them.
  async applyConfig(containerId: string, instance: Instance): Promise<ConfigApplyOutcome> {
    const running = await this.runtime.isRunning(containerId);
    // A stopped container on another image is rebuilt from the row on its next start; nothing to write.
    if (!(await this.isOnCurrentImage(containerId))) {
      if (running) throw new RuntimeImageMismatchError();
      return "restart_required";
    }
    if (!running) {
      await this.stageConfig(containerId, instance);
      return "restart_required";
    }

    // Staging a file a live gateway will never read is how a change disappears silently, so a
    // container whose config we cannot read is a failure rather than a fallback.
    const existing = await this.requireConfig(containerId);
    const files = generateRuntimePatchedOpenclawFiles(
      existing,
      instance.config,
      instance.gatewayToken,
    );

    // Env vars are read once at start-up, so a changed env file is not live until the next boot.
    // Reading it before the write keeps a read failure from stranding an applied config.
    const envWasCurrent = await this.envMatches(containerId, files.dotEnv);
    if (envWasCurrent && configMatches(existing, files.configJson)) {
      // Nothing the runtime reads has changed, so there is no write to spend on it.
      return "applied";
    }

    const applied = await this.execConfigApply(containerId, files.configJson);
    if (applied.status === "rejected") {
      throw new ValidationError(
        `openclaw rejected the config: ${redact(applied.reason, instance)}`,
      );
    }
    if (applied.status === "unreachable") {
      // No session with the gateway, so the file its next boot reads is the way in.
      await this.runtime.putArchive(
        containerId,
        OPENCLAW_STATE_PARENT,
        await buildOpenclawConfigTar(files),
      );
      return "restart_required";
    }
    if (applied.status !== "applied" && !(await this.holdsConfig(containerId, files.configJson))) {
      throw new UpstreamUnavailableError("openclaw", redact(applied.reason, instance));
    }

    await this.runtime.putArchive(
      containerId,
      OPENCLAW_STATE_PARENT,
      await buildOpenclawEnvTar(files.dotEnv),
    );
    return envWasCurrent ? "applied" : "restart_required";
  }

  isOnCurrentImage(containerId: string): Promise<boolean> {
    return this.runtime.isOnImage(containerId, this.image);
  }

  // A write can land and still lose its acknowledgement (the gateway restarts, or rate-limits the
  // confirming call), so the running container decides whether the config is in place — including
  // on a retry, where a previous attempt may already have delivered it.
  private async holdsConfig(containerId: string, desired: string): Promise<boolean> {
    const live = await this.readConfig(containerId).catch(() => null);
    return live !== null && configMatches(live, desired);
  }

  // "could not read" is not "differs": inferring a difference restarts a healthy container and
  // drops its WhatsApp socket for a change that was already live. A missing file is a real answer.
  private async envMatches(containerId: string, dotEnv: string): Promise<boolean> {
    const live = await this.runtime
      .readFile(containerId, OPENCLAW_ENV_PATH, ENV_READ_LIMIT_BYTES)
      .catch((err: unknown) => {
        throw new UpstreamUnavailableError("openclaw", `env read failed: ${errorMessage(err)}`);
      });
    return live !== null && live.toString("utf8") === dotEnv;
  }

  private async execConfigApply(
    containerId: string,
    configJson: string,
  ): Promise<ConfigApplyResult> {
    try {
      const result = await this.runtime.execCommandBuffer(
        containerId,
        buildConfigApplyCommand(OPENCLAW_CONFIG_APPLY_TIMEOUT_MS),
        OPENCLAW_CONFIG_APPLY_TIMEOUT_MS + 5_000,
        64 * 1024,
        Buffer.from(configJson, "utf8"),
      );
      return result.exitCode === 0
        ? parseConfigApplyOutput(result.stdout.toString("utf8"))
        : {
            status: "unreachable",
            reason: result.stderr || `config apply exited ${result.exitCode}`,
          };
    } catch (err) {
      // The program never ran, so the gateway holds no opinion on this config.
      return { status: "unreachable", reason: errorMessage(err) };
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

  probeGateway(
    instance: Instance,
    timeoutMs: number,
    useDockerNetwork: boolean,
  ): Promise<GatewayLiveness> {
    return probeOpenclawGateway(instance, timeoutMs, useDockerNetwork);
  }

  // The probe runs inside the container, so it never depends on how the host reaches the gateway.
  probeWhatsapp(
    instance: Instance,
    timeoutMs: number,
    _useDockerNetwork: boolean,
  ): Promise<WhatsappLinkState> {
    return probeOpenclawWhatsapp(this.runtime, instance, timeoutMs);
  }

  logoutWhatsapp(containerId: string): Promise<WhatsappLogoutResult> {
    return logoutOpenclawWhatsapp(this.runtime, containerId);
  }

  listWhatsappPairingRequests(containerId: string): Promise<WhatsappPairingRequest[]> {
    return listOpenclawWhatsappPairingRequests(this.runtime, containerId);
  }

  async readOwnerIds(containerId: string): Promise<string[]> {
    return readOwnerAllowFrom(await this.requireConfig(containerId));
  }

  // Null means the container genuinely has no config yet, which only a freshly created one can be.
  private async readConfig(containerId: string): Promise<string | null> {
    const live = await this.runtime.readFile(
      containerId,
      OPENCLAW_CONFIG_PATH,
      CONFIG_READ_LIMIT_BYTES,
    );
    return live === null ? null : live.toString("utf8");
  }

  private async requireConfig(containerId: string): Promise<string> {
    const live = await this.readConfig(containerId).catch((err: unknown) => {
      throw new UpstreamUnavailableError("openclaw", `config read failed: ${errorMessage(err)}`);
    });
    if (live === null) {
      throw new UpstreamUnavailableError("openclaw", "container has no config to change");
    }
    return live;
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

// Runtime config holds credentials and owner phone numbers in plaintext; gateway prose can quote
// the value it refused, and none of it may reach logs, the error column, or an API response.
function redact(text: string, instance: Instance): string {
  return secretsOf(instance)
    .filter((secret): secret is string => Boolean(secret))
    .reduce((redacted, secret) => redacted.split(secret).join("[redacted]"), text);
}

function secretsOf(instance: Instance): (string | undefined)[] {
  const secrets: (string | undefined)[] = [
    instance.gatewayToken,
    instance.config.provider.apiKey,
    instance.config.integrations?.relayToken,
  ];
  for (const channel of instance.config.channels) {
    switch (channel.type) {
      case "telegram":
        secrets.push(channel.botToken, ...(channel.allowFrom ?? []));
        break;
      case "discord":
        secrets.push(channel.token);
        break;
      case "slack":
        secrets.push(channel.botToken, channel.appToken);
        break;
      case "whatsapp":
        secrets.push(channel.ownerNumber);
        break;
    }
  }
  return secrets;
}

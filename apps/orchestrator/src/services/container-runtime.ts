import type { Readable } from "node:stream";
import type { RuntimeUser } from "./runtime-users.js";

export type RestartPolicy = "unless-stopped" | "no";

export interface ContainerCreateOptions {
  name: string;
  image: string;
  internalPort: number;
  healthPath: string;
  hostPort: number;
  envVars: string[];
  command?: string[];
  memoryBytes: number;
  cpuShares: number;
  labels: Record<string, string>;
  restartPolicy: RestartPolicy;
  // Loopback beside the orchestrator; a worker binds its VPC IP so the orchestrator can dial the gateway.
  bindIp: string;
  capDrop?: string[] | null;
  capAdd?: string[];
  securityOpt?: string[] | null;
  volumeMounts?: VolumeMount[];
  shmSizeBytes?: number;
  initialArchive?: {
    targetPath: string;
    content: Buffer | Readable;
  };
}

export interface OneOffOptions {
  name: string;
  image: string;
  cmd: string[];
  timeoutMs: number;
  memoryBytes: number;
  volumeMounts: VolumeMount[];
}

export interface OneOffResult {
  exitCode: number;
  // stdout and stderr interleaved, bounded.
  output: string;
}

export interface VolumeMount {
  // A volume name, or an absolute host path (Docker treats a leading "/" as a bind).
  name: string;
  containerPath: string;
  readOnly?: boolean;
}

export interface SidecarCreateOptions {
  name: string;
  image: string;
  envVars: string[];
  memoryBytes: number;
  cpuShares: number;
  labels: Record<string, string>;
  volumeMounts: VolumeMount[];
  tmpfsMounts?: TmpfsMount[];
  // Random host port on bindIp (127.0.0.1 in dev, the worker's VPC IP remotely); local prod uses Docker DNS.
  publish?: { port: number; bindIp: string };
}

export interface TmpfsMount {
  path: string;
  options: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecBufferResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface ExecStreamResult {
  stdout: Readable;
  done: Promise<ExecResult>;
}

export interface ArchiveStreamResult extends ExecStreamResult {
  contentLength: number;
}

export interface ContainerArchiveFile {
  path: string;
  sizeBytes: number;
}

export type ContainerHealth = "starting" | "healthy" | "unhealthy" | "none";

export interface ContainerState {
  running: boolean;
  restarting: boolean;
  health: ContainerHealth;
  startedAt: Date | null;
}

export interface ContainerMemory {
  usedBytes: number;
  limitBytes: number;
}

// Boots can outlast Docker's start period (doctor migrations run ~2 min), so age counts as booting too.
export const BOOT_GRACE_MS = 180_000;

export function isContainerBooting(state: ContainerState, now: number): boolean {
  const young = state.startedAt !== null && now - state.startedAt.getTime() < BOOT_GRACE_MS;
  return state.restarting || state.health === "starting" || young;
}

// One implementation per host kind; nothing vendor-specific crosses this boundary.
export interface ContainerRuntime {
  ping(): Promise<void>;
  ensureImagePulled(image: string): Promise<void>;
  ensureNetworkExists(): Promise<void>;
  ensureVolumeExists(name: string): Promise<void>;
  hasVolume(name: string): Promise<boolean>;
  removeVolume(name: string): Promise<void>;

  create(opts: ContainerCreateOptions): Promise<string>;
  createSidecar(opts: SidecarCreateOptions): Promise<string>;
  runOneOff(opts: OneOffOptions): Promise<OneOffResult>;
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeoutSec?: number): Promise<void>;
  restart(containerId: string, timeoutSec?: number): Promise<void>;
  remove(containerId: string): Promise<void>;
  removeIfExists(name: string): Promise<void>;

  findContainerByName(name: string): Promise<string | null>;
  containerState(containerId: string): Promise<ContainerState | null>;
  isRunning(containerId: string): Promise<boolean>;
  isOnImage(containerId: string, imageRef: string): Promise<boolean>;
  waitForHealthy(containerId: string, timeoutMs: number): Promise<boolean>;
  getPublishedHostPort(containerId: string, internalPort: number): Promise<number | null>;
  memoryUsage(containerId: string): Promise<ContainerMemory | null>;

  putArchive(containerId: string, targetPath: string, archive: Buffer | Readable, signal?: AbortSignal): Promise<void>;
  // Docker archive read: a tar of `path` (its basename as the top-level entry); works on a stopped container.
  getArchive(containerId: string, path: string, signal?: AbortSignal): Promise<Readable>;
  putArchiveUnderDir(
    containerId: string,
    parentDir: string,
    dirName: string,
    tarBuffer: Buffer,
    owner: RuntimeUser,
  ): Promise<void>;
  readFile(containerId: string, path: string, maxBytes: number): Promise<Buffer | null>;
  streamFile(containerId: string, path: string, timeoutMs: number): Promise<ExecStreamResult>;
  removeFile(containerId: string, path: string): Promise<void>;

  execCommand(containerId: string, cmd: string[], timeoutMs: number): Promise<number>;
  execCommandWithOutput(containerId: string, cmd: string[], timeoutMs: number): Promise<ExecResult>;
  execCommandBuffer(
    containerId: string,
    cmd: string[],
    timeoutMs: number,
    maxStdoutBytes: number,
    input?: Buffer,
  ): Promise<ExecBufferResult>;
}

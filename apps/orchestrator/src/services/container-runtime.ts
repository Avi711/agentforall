import Docker from "dockerode";
import tar from "tar-stream";
import { PassThrough, Readable, Writable } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import type { RuntimeUser } from "./runtime-users.js";

const DEFAULT_EXEC_STDOUT_LIMIT_BYTES = 512 * 1024 * 1024;
// Docker re-checks health every 30s; poll faster so restarts are not needlessly delayed.
const HEALTH_POLL_MS = 2_000;

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

export interface VolumeMount {
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
  /** Publish to a random 127.0.0.1 host port. Dev-only: prod uses Docker DNS. */
  publishPort?: number;
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

export class ContainerRuntime {
  constructor(
    private readonly docker: Docker,
    private readonly networkName: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async ensureImagePulled(image: string): Promise<void> {
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async ensureNetworkExists(): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: [this.networkName] },
    });
    const exists = networks.some((n) => n.Name === this.networkName);
    if (!exists) {
      await this.docker.createNetwork({
        Name: this.networkName,
        Driver: "bridge",
        Internal: false,
      });
      this.logger.info({ network: this.networkName }, "docker network created");
    }
  }

  async create(opts: ContainerCreateOptions): Promise<string> {
    const portKey = `${opts.internalPort}/tcp`;

    const container = await this.docker.createContainer({
      name: opts.name,
      Image: opts.image,
      ...(opts.command ? { Cmd: opts.command } : {}),
      ExposedPorts: { [portKey]: {} },
      Env: opts.envVars,
      Labels: {
        ...opts.labels,
        "agent-forall.managed": "true",
      },
      Healthcheck: {
        Test: [
          "CMD",
          "curl",
          "-fsS",
          `http://127.0.0.1:${opts.internalPort}${opts.healthPath}`,
        ],
        Interval: 30_000_000_000,
        Timeout: 5_000_000_000,
        Retries: 3,
        StartPeriod: 90_000_000_000,
      },
      HostConfig: {
        PortBindings: {
          [portKey]: [{ HostIp: "127.0.0.1", HostPort: String(opts.hostPort) }],
        },
        Memory: opts.memoryBytes,
        MemorySwap: opts.memoryBytes,
        ...(opts.shmSizeBytes ? { ShmSize: opts.shmSizeBytes } : {}),
        CpuShares: opts.cpuShares,
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        NetworkMode: this.networkName,
        ...(opts.capDrop === null
          ? {}
          : { CapDrop: opts.capDrop ?? ["ALL"] }),
        CapAdd: opts.capAdd ?? ["NET_BIND_SERVICE"],
        ...(opts.securityOpt === null
          ? {}
          : { SecurityOpt: opts.securityOpt ?? ["no-new-privileges:true"] }),
        Binds: opts.volumeMounts?.map(formatBind) ?? [],
      },
    });

    if (opts.initialArchive) {
      await container.putArchive(opts.initialArchive.content, {
        path: opts.initialArchive.targetPath,
      });
    }

    return container.id;
  }

  async createSidecar(opts: SidecarCreateOptions): Promise<string> {
    const portKey = opts.publishPort ? `${opts.publishPort}/tcp` : undefined;
    const container = await this.docker.createContainer({
      name: opts.name,
      Image: opts.image,
      Env: opts.envVars,
      Labels: {
        ...opts.labels,
        "agent-forall.managed": "true",
      },
      ...(portKey ? { ExposedPorts: { [portKey]: {} } } : {}),
      HostConfig: {
        Memory: opts.memoryBytes,
        MemorySwap: opts.memoryBytes,
        CpuShares: opts.cpuShares,
        RestartPolicy: { Name: "no" },
        NetworkMode: this.networkName,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        Binds: opts.volumeMounts.map(formatBind),
        ...(opts.tmpfsMounts && opts.tmpfsMounts.length > 0
          ? {
              Tmpfs: Object.fromEntries(
                opts.tmpfsMounts.map((mount) => [mount.path, mount.options]),
              ),
            }
          : {}),
        ...(portKey
          ? {
              // Empty HostPort = Docker picks one; 127.0.0.1 keeps it host-local.
              PortBindings: { [portKey]: [{ HostIp: "127.0.0.1", HostPort: "" }] },
            }
          : {}),
      },
    });
    return container.id;
  }

  // Polls because Docker-on-Windows can report empty Ports for ~100s of ms after start().
  async getPublishedHostPort(
    containerId: string,
    internalPort: number,
  ): Promise<number | null> {
    const key = `${internalPort}/tcp`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const info = await this.inspect(containerId);
      const hostPort = info?.NetworkSettings.Ports?.[key]?.[0]?.HostPort;
      if (hostPort) return Number(hostPort);
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  async ensureVolumeExists(name: string): Promise<void> {
    try {
      await this.docker.getVolume(name).inspect();
      return;
    } catch (err: unknown) {
      if (!isDockerNotFound(err)) throw err;
    }
    await this.docker.createVolume({
      Name: name,
      Labels: { "agent-forall.managed": "true" },
    });
  }

  async removeVolume(name: string): Promise<void> {
    try {
      await this.docker.getVolume(name).remove({ force: true });
    } catch (err: unknown) {
      if (isDockerNotFound(err)) return;
      throw err;
    }
  }

  async findContainerByName(name: string): Promise<string | null> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { name: [name] },
    });
    const exact = containers.find((c) =>
      c.Names.some((n) => n === `/${name}`),
    );
    return exact?.Id ?? null;
  }

  // Extract `tarBuffer` into `targetPath`, stamping every entry with the supplied uid/gid.
  async putArchiveBuffer(
    containerId: string,
    targetPath: string,
    tarBuffer: Buffer,
    owner: RuntimeUser,
  ): Promise<void> {
    const owned = await rewriteRuntimeUsership(tarBuffer, owner);
    await this.docker
      .getContainer(containerId)
      .putArchive(owned, { path: targetPath });
  }

  // Wraps a flat tar under `<dirName>/` so putArchive can create the leaf.
  async putArchiveUnderDir(
    containerId: string,
    parentDir: string,
    dirName: string,
    tarBuffer: Buffer,
    owner: RuntimeUser,
  ): Promise<void> {
    const wrapped = await wrapTarUnderDirectory(tarBuffer, dirName, owner);
    await this.docker
      .getContainer(containerId)
      .putArchive(wrapped, { path: parentDir });
  }

  async streamFile(
    containerId: string,
    path: string,
    timeoutMs: number,
  ): Promise<ExecStreamResult> {
    return this.execCommandStream(containerId, ["cat", path], timeoutMs);
  }

  async removeFile(containerId: string, path: string): Promise<void> {
    await this.execCommand(containerId, ["rm", "-f", path], 15_000);
  }

  async putArchive(
    containerId: string,
    targetPath: string,
    archive: Buffer | Readable,
  ): Promise<void> {
    await this.docker
      .getContainer(containerId)
      .putArchive(archive, { path: targetPath });
  }

  async isRunning(containerId: string): Promise<boolean> {
    const info = await this.inspect(containerId);
    return Boolean(info?.State.Running);
  }

  // Resolves once the container has left Docker's start-up window (healthy, unhealthy, restarting,
  // stopped, or no healthcheck) or after timeoutMs; true only when it ended healthy.
  async waitForHealthy(containerId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const info = await this.inspect(containerId);
      const health = info?.State.Health?.Status;
      const starting = Boolean(info?.State.Running) && !info?.State.Restarting && health === "starting";
      if (!starting) return health === "healthy";
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    }
  }

  async start(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }

  async stop(containerId: string, timeoutSec = 30): Promise<void> {
    await this.docker.getContainer(containerId).stop({ t: timeoutSec });
  }

  async restart(containerId: string, timeoutSec = 30): Promise<void> {
    await this.docker.getContainer(containerId).restart({ t: timeoutSec });
  }

  async remove(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true, v: true });
    } catch (err: unknown) {
      if (isDockerNotFound(err)) return;
      throw err;
    }
  }

  async inspect(
    containerId: string,
  ): Promise<Docker.ContainerInspectInfo | null> {
    try {
      return await this.docker.getContainer(containerId).inspect();
    } catch (err: unknown) {
      if (isDockerNotFound(err)) return null;
      throw err;
    }
  }

  async listManagedContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({
      all: true,
      filters: { label: ["agent-forall.managed=true"] },
    });
  }

  async ping(): Promise<void> {
    await this.docker.ping();
  }

  // Run a command inside a running container; resolves with the exit code.
  // Stdout/stderr are drained but discarded. Bounded by `timeoutMs` so a
  // hung command can't block the orchestrator.
  async execCommand(
    containerId: string,
    cmd: string[],
    timeoutMs: number,
  ): Promise<number> {
    const result = await this.execCommandWithOutput(containerId, cmd, timeoutMs);
    return result.exitCode;
  }

  async execCommandWithOutput(
    containerId: string,
    cmd: string[],
    timeoutMs: number,
  ): Promise<ExecResult> {
    const result = await this.execCommandBuffer(
      containerId,
      cmd,
      timeoutMs,
      DEFAULT_EXEC_STDOUT_LIMIT_BYTES,
    );
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr,
    };
  }

  async execCommandBuffer(
    containerId: string,
    cmd: string[],
    timeoutMs: number,
    maxStdoutBytes: number,
  ): Promise<ExecBufferResult> {
    const exec = await this.docker.getContainer(containerId).exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const boundedStdout = captureBoundedWritable(stdout, maxStdoutBytes);
    this.docker.modem.demuxStream(
      stream,
      boundedStdout,
      captureWritable(stderr),
    );
    const drained = new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
      boundedStdout.on("error", reject);
      stream.resume();
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        drained,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            const err = new Error(`exec timeout after ${timeoutMs}ms`);
            stream.destroy(err);
            reject(err);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const result = await exec.inspect();
    return {
      exitCode: result.ExitCode ?? -1,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
  }

  async execCommandStream(
    containerId: string,
    cmd: string[],
    timeoutMs: number,
  ): Promise<ExecStreamResult> {
    const exec = await this.docker.getContainer(containerId).exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const raw = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr: Buffer[] = [];
    const stderrWritable = captureWritable(stderr);
    this.docker.modem.demuxStream(raw, stdout, stderrWritable);

    const done = new Promise<ExecResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const err = new Error(`exec timeout after ${timeoutMs}ms`);
        raw.destroy(err);
        stdout.destroy(err);
        cleanup();
        reject(err);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        stderrWritable.end();
      };
      const fail = (err: Error) => {
        cleanup();
        reject(err);
      };

      raw.on("end", async () => {
        try {
          stdout.end();
          const result = await exec.inspect();
          cleanup();
          resolve({
            exitCode: result.ExitCode ?? -1,
            stdout: "",
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });
      raw.on("error", fail);
      stdout.on("error", (err) => {
        raw.destroy(err);
        fail(err);
      });
      stderrWritable.on("error", fail);
    });

    return { stdout, done };
  }

  // Remove a container by name if it exists; no-op otherwise. Lets callers
  // claim a deterministic name without a stat-then-remove dance.
  async removeIfExists(name: string): Promise<void> {
    const id = await this.findContainerByName(name);
    if (id) await this.remove(id);
  }

}

function captureWritable(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
}

function captureBoundedWritable(chunks: Buffer[], maxBytes: number): Writable {
  let total = 0;
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error(`archive exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
      callback();
    },
  });
}

function isDockerNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode: number }).statusCode === 404
  );
}

function formatBind(mount: VolumeMount): string {
  const suffix = mount.readOnly ? ":ro" : "";
  return `${mount.name}:${mount.containerPath}${suffix}`;
}

const MAX_WRAP_INPUT_BYTES = DEFAULT_EXEC_STDOUT_LIMIT_BYTES;

async function wrapTarUnderDirectory(
  sourceTar: Buffer,
  dirName: string,
  owner: RuntimeUser,
): Promise<Buffer> {
  const prefix = dirName.replace(/\/+$/, "") + "/";
  return streamRewrap(
    sourceTar,
    (header) => ({ ...header, name: `${prefix}${header.name}`, ...owner }),
    { name: prefix, type: "directory", mode: 0o755, ...owner },
  );
}

async function rewriteRuntimeUsership(
  sourceTar: Buffer,
  owner: RuntimeUser,
): Promise<Buffer> {
  return streamRewrap(sourceTar, (header) => ({ ...header, ...owner }));
}

async function streamRewrap(
  sourceTar: Buffer,
  mapHeader: (header: tar.Headers) => tar.Headers,
  leadingEntry?: tar.Headers,
): Promise<Buffer> {
  if (sourceTar.length > MAX_WRAP_INPUT_BYTES) {
    throw new Error(
      `tar input ${sourceTar.length} bytes exceeds cap ${MAX_WRAP_INPUT_BYTES}`,
    );
  }
  const extract = tar.extract();
  const pack = tar.pack();
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    pack.on("data", (chunk: Buffer) => chunks.push(chunk));
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.on("error", reject);
    extract.on("error", reject);

    if (leadingEntry) {
      pack.entry(leadingEntry, (err) => {
        if (err) reject(err);
      });
    }

    extract.on("entry", (header, stream, next) => {
      if (!isSupportedArchiveEntry(header)) {
        reject(new Error(`backup archive contains unsupported entry type ${header.type}`));
        stream.resume();
        return;
      }
      const mapped = mapHeader(header);
      stream.on("error", reject);
      stream.on("end", next);

      if (mapped.type === "symlink" && !isSafeLinkName(mapped.linkname)) {
        stream.resume();
        return;
      }

      const entry = pack.entry(mapped, (err) => {
        if (err) reject(err);
      });
      if (isMetadataOnlyEntry(header)) {
        stream.resume();
        entry.end();
        return;
      }
      stream.pipe(entry);
    });

    extract.on("finish", () => pack.finalize());
    Readable.from(sourceTar).pipe(extract);
  });
}

function isSupportedArchiveEntry(header: tar.Headers): boolean {
  return (
    header.type === "file" ||
    header.type === "directory" ||
    header.type === "symlink"
  );
}

function isMetadataOnlyEntry(header: tar.Headers): boolean {
  return header.type === "directory" || header.type === "symlink";
}

function isSafeLinkName(linkname: string | null | undefined): boolean {
  if (!linkname) return false;
  const normalized = linkname.replace(/\\/g, "/");
  return !(
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  );
}

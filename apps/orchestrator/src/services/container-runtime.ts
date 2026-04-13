import Docker from "dockerode";
import tar from "tar-stream";
import type { FastifyBaseLogger } from "fastify";

const INTERNAL_PORT = 18789;

export interface ContainerCreateOptions {
  name: string;
  image: string;
  hostPort: number;
  envVars: string[];
  memoryBytes: number;
  cpuShares: number;
  openclawConfig: string;
  dotEnv: string;
  labels: Record<string, string>;
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
    const portKey = `${INTERNAL_PORT}/tcp`;

    const container = await this.docker.createContainer({
      name: opts.name,
      Image: opts.image,
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
          `http://127.0.0.1:${INTERNAL_PORT}/healthz`,
        ],
        Interval: 30_000_000_000,
        Timeout: 5_000_000_000,
        Retries: 3,
        StartPeriod: 30_000_000_000,
      },
      HostConfig: {
        PortBindings: {
          [portKey]: [{ HostIp: "127.0.0.1", HostPort: String(opts.hostPort) }],
        },
        Memory: opts.memoryBytes,
        MemorySwap: opts.memoryBytes,
        CpuShares: opts.cpuShares,
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        NetworkMode: this.networkName,
        CapDrop: ["ALL"],
        CapAdd: ["NET_BIND_SERVICE"],
        SecurityOpt: ["no-new-privileges:true"],
      },
    });

    const configArchive = await this.buildConfigTar(
      opts.openclawConfig,
      opts.dotEnv,
    );
    await container.putArchive(configArchive, {
      path: "/home/node/.openclaw",
    });

    return container.id;
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
    await this.docker.getContainer(containerId).remove({ force: true, v: true });
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

  async injectConfig(
    containerId: string,
    openclawConfig: string,
    dotEnv: string,
  ): Promise<void> {
    const archive = await this.buildConfigTar(openclawConfig, dotEnv);
    await this.docker
      .getContainer(containerId)
      .putArchive(archive, { path: "/home/node/.openclaw" });
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

  private async buildConfigTar(
    openclawJson: string,
    dotEnv: string,
  ): Promise<Buffer> {
    const pack = tar.pack();

    await new Promise<void>((resolve, reject) => {
      pack.entry({ name: "openclaw.json" }, openclawJson, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      pack.entry({ name: ".env" }, dotEnv, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    pack.finalize();

    const chunks: Buffer[] = [];
    for await (const chunk of pack) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }
}

function isDockerNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode: number }).statusCode === 404
  );
}

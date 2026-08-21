import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { InstanceManager } from "./instance-manager.js";

const BACKUP_EXPORT_TTL_SECONDS = 10 * 60;
const BACKUP_EXPORT_JOB_TTL_MS = 15 * 60 * 1000;
const ARCHIVE_PREPARE_TIMEOUT_MS = 2 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SIGN_URL_TIMEOUT_MS = 10_000;

export interface BackupExportStorage {
  uploadObjectStream(input: {
    objectName: string;
    contentType: string;
    contentLength: number;
    body: Readable;
  }): Promise<void>;
  createReadSignedUrl(input: {
    objectName: string;
    expiresInSeconds: number;
    responseDisposition?: string;
  }): Promise<string>;
  deleteObject(objectName: string): Promise<void>;
}

interface BackupExportLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
}

export type BackupExportJob =
  | { id: string; status: "pending" }
  | { id: string; status: "ready"; downloadUrl: string }
  | { id: string; status: "error"; message: string };

interface StoredExportJob {
  id: string;
  key: string;
  status: "pending" | "ready" | "error";
  downloadUrl?: string;
  message?: string;
  expiresAtMs: number;
}

export class BackupExportManager {
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly jobs = new Map<string, StoredExportJob>();
  private readonly jobsByKey = new Map<string, string>();

  constructor(
    private readonly instances: InstanceManager,
    private readonly storage: BackupExportStorage,
    private readonly logger: BackupExportLogger = noopLogger,
  ) {}

  async createDownloadUrl(id: string, userId: string): Promise<string> {
    this.logger.info({ instanceId: id }, "backup export requested");
    await this.instances.assertAgentBackupReadable(id, userId);
    const objectName = await this.getOrCreateBackupObject(id, userId);
    const downloadUrl = await this.createSignedUrl(id, objectName);
    this.logger.info({ instanceId: id, objectName }, "backup export signed url ready");
    return downloadUrl;
  }

  async startDownloadJob(id: string, userId: string): Promise<BackupExportJob> {
    await this.instances.assertAgentBackupReadable(id, userId);
    this.pruneExpired();

    const key = this.key(id, userId);
    const existingId = this.jobsByKey.get(key);
    const existing = existingId ? this.jobs.get(existingId) : undefined;
    if (existing?.status === "pending") return this.toJob(existing);

    const job: StoredExportJob = {
      id: randomUUID(),
      key,
      status: "pending",
      expiresAtMs: Date.now() + BACKUP_EXPORT_JOB_TTL_MS,
    };
    this.jobs.set(job.id, job);
    this.jobsByKey.set(key, job.id);

    void this.createDownloadUrl(id, userId)
      .then((downloadUrl) => {
        job.status = "ready";
        job.downloadUrl = downloadUrl;
        job.expiresAtMs = Date.now() + BACKUP_EXPORT_JOB_TTL_MS;
      })
      .catch((err: unknown) => {
        job.status = "error";
        job.message = err instanceof Error ? err.message : String(err);
        job.expiresAtMs = Date.now() + BACKUP_EXPORT_JOB_TTL_MS;
      });

    return this.toJob(job);
  }

  getDownloadJob(id: string, userId: string, jobId: string): BackupExportJob | null {
    this.pruneExpired();
    const job = this.jobs.get(jobId);
    if (!job || job.key !== this.key(id, userId)) return null;
    return this.toJob(job);
  }

  private async getOrCreateBackupObject(
    id: string,
    userId: string,
  ): Promise<string> {
    const key = this.key(id, userId);
    const existing = this.inFlight.get(key);
    if (existing) {
      this.logger.info({ instanceId: id }, "backup export joined in-flight upload");
      return existing;
    }

    const upload = this.uploadBackupObject(id, userId).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, upload);
    return upload;
  }

  private async uploadBackupObject(id: string, userId: string): Promise<string> {
    this.logger.info({ instanceId: id }, "backup export archive starting");
    const backup = await withTimeout(
      this.instances.exportAgentBackupStream(id, userId),
      ARCHIVE_PREPARE_TIMEOUT_MS,
      "backup archive preparation timed out",
    );
    const objectName = `exports/${encodeURIComponent(userId)}/${id}/${randomUUID()}.tar.gz`;
    this.logger.info(
      { instanceId: id, objectName, contentLength: backup.contentLength },
      "backup export upload starting",
    );
    try {
      await Promise.all([
        withTimeout(
          this.storage.uploadObjectStream({
            objectName,
            contentType: "application/gzip",
            contentLength: backup.contentLength,
            body: backup.stdout,
          }),
          UPLOAD_TIMEOUT_MS,
          "backup upload timed out",
        ),
        backup.done,
      ]);
    } catch (err) {
      this.logger.warn(
        { instanceId: id, objectName, err },
        "backup export upload failed",
      );
      backup.stdout.destroy();
      await backup.done.catch(() => undefined);
      await this.storage.deleteObject(objectName).catch(() => undefined);
      throw err;
    }
    this.logger.info(
      { instanceId: id, objectName },
      "backup export upload completed",
    );
    return objectName;
  }

  private key(id: string, userId: string): string {
    return `${userId}:${id}`;
  }

  private toJob(job: StoredExportJob): BackupExportJob {
    if (job.status === "ready" && job.downloadUrl) {
      return { id: job.id, status: "ready", downloadUrl: job.downloadUrl };
    }
    if (job.status === "error") {
      return { id: job.id, status: "error", message: job.message ?? "export failed" };
    }
    return { id: job.id, status: "pending" };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs) {
      if (job.expiresAtMs > now) continue;
      this.jobs.delete(jobId);
      if (this.jobsByKey.get(job.key) === jobId) this.jobsByKey.delete(job.key);
    }
  }

  private createSignedUrl(id: string, objectName: string): Promise<string> {
    return withTimeout(
      this.storage.createReadSignedUrl({
        objectName,
        expiresInSeconds: BACKUP_EXPORT_TTL_SECONDS,
        responseDisposition: `attachment; filename="agent-${id.slice(0, 8)}.tar.gz"`,
      }),
      SIGN_URL_TIMEOUT_MS,
      "backup signed URL creation timed out",
    );
  }
}

const noopLogger: BackupExportLogger = {
  info() {},
  warn() {},
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

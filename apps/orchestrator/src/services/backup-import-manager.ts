import { randomUUID } from "node:crypto";
import type { Instance } from "../domain/types.js";
import type { InstanceManager } from "./instance-manager.js";
import type { BackupTransferTokenService } from "./backup-transfer-token.js";
import {
  AuthenticationError,
  InvalidBackupError,
  UpstreamUnavailableError,
} from "../domain/errors.js";

const MAX_BACKUP_UPLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_BACKUP_CONTENT_TYPE = "application/gzip";
const ALLOWED_BACKUP_CONTENT_TYPES = new Set([
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream",
]);

export interface BackupUploadSession {
  uploadUrl: string;
  restoreToken: string;
  expiresAt: string;
}

export interface BackupObjectStorage {
  createResumableUpload(input: {
    objectName: string;
    contentType: string;
    contentLength: number;
  }): Promise<string>;
  deleteObject(objectName: string): Promise<void>;
}

export class BackupImportManager {
  constructor(
    private readonly storage: BackupObjectStorage,
    private readonly tokens: BackupTransferTokenService,
    private readonly instances: InstanceManager,
    private readonly ttlSeconds: number,
  ) {}

  async createUploadSession(input: {
    userId: string;
    displayName: string;
    contentLength: number;
    contentType?: string;
  }): Promise<BackupUploadSession> {
    this.assertContentLength(input.contentLength);
    const contentType = this.normalizeContentType(input.contentType);

    const objectName = this.objectName(input.userId);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const uploadUrl = await this.createUploadUrl({
      objectName,
      contentType,
      contentLength: input.contentLength,
    });

    return {
      uploadUrl,
      restoreToken: this.tokens.createRestoreUploadToken({
        userId: input.userId,
        displayName: input.displayName,
        objectName,
        contentLength: input.contentLength,
        contentType,
        expiresAt,
      }),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async restoreUploadedBackup(
    userId: string,
    restoreToken: string,
  ): Promise<Instance> {
    const grant = this.tokens.verifyImport(restoreToken);
    if (!grant || grant.userId !== userId) throw new AuthenticationError();

    try {
      return await this.instances.create(grant.userId, {
        displayName: grant.displayName,
        channels: [{ type: "whatsapp" }],
        backupImport: {
          objectName: grant.objectName,
          contentLength: grant.contentLength,
          contentType: grant.contentType,
        },
      });
    } catch (err) {
      if (err instanceof InvalidBackupError) {
        await this.storage.deleteObject(grant.objectName).catch(() => undefined);
      }
      throw err;
    }
  }

  private async createUploadUrl(input: {
    objectName: string;
    contentType: string;
    contentLength: number;
  }): Promise<string> {
    try {
      return await this.storage.createResumableUpload(input);
    } catch {
      throw new UpstreamUnavailableError("backup storage");
    }
  }

  private assertContentLength(contentLength: number): void {
    if (!Number.isInteger(contentLength) || contentLength <= 0) {
      throw new InvalidBackupError("backup size is required");
    }
    if (contentLength > MAX_BACKUP_UPLOAD_BYTES) {
      throw new InvalidBackupError("backup archive is too large");
    }
  }

  private normalizeContentType(contentType: string | undefined): string {
    const normalized = contentType?.trim() || DEFAULT_BACKUP_CONTENT_TYPE;
    if (!ALLOWED_BACKUP_CONTENT_TYPES.has(normalized)) {
      throw new InvalidBackupError("backup content type is not supported");
    }
    return normalized;
  }

  private objectName(userId: string): string {
    return `imports/${userId}/${randomUUID()}.tar.gz`;
  }
}

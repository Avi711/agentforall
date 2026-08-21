import { Storage, type Bucket, type File } from "@google-cloud/storage";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REQUEST_TIMEOUT_MS = 30_000;
const RESUMABLE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export class GcsBackupStorage {
  private readonly bucketRef: Bucket;

  constructor(
    bucket: string,
    private readonly uploadOrigin: string,
    storage = new Storage(),
  ) {
    this.bucketRef = storage.bucket(bucket);
  }

  async createResumableUpload(input: {
    objectName: string;
    contentType: string;
    contentLength: number;
  }): Promise<string> {
    try {
      const [uploadUrl] = await this.file(input.objectName).createResumableUpload({
        origin: this.uploadOrigin,
        metadata: {
          cacheControl: "no-store",
          contentType: input.contentType,
        },
      });
      return uploadUrl;
    } catch (err) {
      throw toGcsStorageError("upload session", err);
    }
  }

  async openObjectStream(
    objectName: string,
    maxBytes: number,
  ): Promise<{ body: Readable; contentLength: number; contentType: string | null }> {
    const file = this.file(objectName);
    const metadata = await this.objectMetadata(file);
    if (metadata.size > maxBytes) throw new Error("backup archive is too large");

    try {
      return {
        body: file.createReadStream() as Readable,
        contentLength: metadata.size,
        contentType: metadata.contentType,
      };
    } catch (err) {
      throw toGcsStorageError("download", err);
    }
  }

  async uploadObjectStream(input: {
    objectName: string;
    contentType: string;
    contentLength: number;
    body: Readable;
  }): Promise<void> {
    const file = this.file(input.objectName);
    try {
      await pipeline(
        input.body,
        file.createWriteStream({
          resumable: true,
          chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES,
          preconditionOpts: { ifGenerationMatch: 0 },
          validation: "crc32c",
          metadata: {
            cacheControl: "no-store",
            contentType: input.contentType,
          },
        }),
      );
      await this.assertUploadedSize(file, input.contentLength);
    } catch (err) {
      throw toGcsStorageError("upload", err);
    }
  }

  async createReadSignedUrl(input: {
    objectName: string;
    expiresInSeconds: number;
    responseDisposition?: string;
  }): Promise<string> {
    try {
      const [url] = await this.file(input.objectName).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + input.expiresInSeconds * 1000,
        responseDisposition: input.responseDisposition,
      });
      return url;
    } catch (err) {
      throw toGcsStorageError("sign url", err);
    }
  }

  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.file(objectName).delete({ ignoreNotFound: true });
    } catch (err) {
      throw toGcsStorageError("delete", err);
    }
  }

  private file(objectName: string): File {
    return this.bucketRef.file(objectName);
  }

  private async objectMetadata(
    file: File,
  ): Promise<{ size: number; contentType: string | null }> {
    try {
      const [metadata] = await file.getMetadata({ timeout: REQUEST_TIMEOUT_MS });
      const size = Number(metadata.size ?? 0);
      if (!Number.isSafeInteger(size)) throw new Error("invalid object size");
      return {
        size,
        contentType:
          typeof metadata.contentType === "string" ? metadata.contentType : null,
      };
    } catch (err) {
      throw toGcsStorageError("metadata", err);
    }
  }

  private async assertUploadedSize(file: File, expectedBytes: number): Promise<void> {
    const metadata = await this.objectMetadata(file);
    if (metadata.size !== expectedBytes) {
      throw new Error("backup archive upload size mismatch");
    }
  }
}

export class GcsStorageError extends Error {
  constructor(
    operation: string,
    public readonly status: number,
    cause?: unknown,
  ) {
    super(`GCS ${operation} failed with ${status}`, { cause });
    this.name = "GcsStorageError";
  }

  get transient(): boolean {
    return TRANSIENT_STATUSES.has(this.status);
  }
}

function toGcsStorageError(operation: string, err: unknown): Error {
  const status = readErrorStatus(err);
  if (status !== null) return new GcsStorageError(operation, status, err);
  return err instanceof Error ? err : new Error(String(err));
}

function readErrorStatus(err: unknown): number | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "number"
  ) {
    return (err as { code: number }).code;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { BackupImportManager } from "../src/services/backup-import-manager.js";
import { BackupTransferTokenService } from "../src/services/backup-transfer-token.js";
import { InvalidBackupError } from "../src/domain/errors.js";
import type { Instance, CreateInstanceInput } from "../src/domain/types.js";
import type { InstanceManager } from "../src/services/instance-manager.js";

const SECRET = "a".repeat(64);

test("backup import session signs object metadata", async () => {
  const tokens = new BackupTransferTokenService([SECRET]);
  const manager = new BackupImportManager(
    {
      async createResumableUpload(input) {
        assert.equal(input.contentType, "application/gzip");
        assert.equal(input.contentLength, 123);
        return `https://storage.example/${input.objectName}`;
      },
      async deleteObject() {
        throw new Error("delete should not be called");
      },
    },
    tokens,
    fakeInstanceManager(),
    300,
  );

  const session = await manager.createUploadSession({
    userId: "user-1",
    displayName: "Agent",
    contentLength: 123,
  });

  const grant = tokens.verifyImport(session.restoreToken);
  assert.equal(grant?.contentLength, 123);
  assert.equal(grant?.contentType, "application/gzip");
  assert.match(grant?.objectName ?? "", /^imports\/user-1\/.+\.tar\.gz$/);
});

test("backup import restore passes object reference into provisioning", async () => {
  const tokens = new BackupTransferTokenService([SECRET]);
  const seen: CreateInstanceInput[] = [];
  const restoreToken = tokens.createRestoreUploadToken({
    userId: "user-1",
    displayName: "Agent",
    objectName: "imports/user-1/backup.tar.gz",
    contentLength: 123,
    contentType: "application/gzip",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const manager = new BackupImportManager(
    fakeStorage(),
    tokens,
    fakeInstanceManager(async (_userId, input) => {
      seen.push(input);
      return {} as Instance;
    }),
    300,
  );

  await manager.restoreUploadedBackup("user-1", restoreToken);

  assert.deepEqual(seen[0]?.backupImport, {
    objectName: "imports/user-1/backup.tar.gz",
    contentLength: 123,
    contentType: "application/gzip",
  });
});

test("backup import deletes object when restore validation fails", async () => {
  const tokens = new BackupTransferTokenService([SECRET]);
  const deleted: string[] = [];
  const restoreToken = tokens.createRestoreUploadToken({
    userId: "user-1",
    displayName: "Agent",
    objectName: "imports/user-1/backup.tar.gz",
    contentLength: 123,
    contentType: "application/gzip",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const manager = new BackupImportManager(
    {
      async createResumableUpload() {
        throw new Error("upload session should not be called");
      },
      async deleteObject(objectName) {
        deleted.push(objectName);
      },
    },
    tokens,
    fakeInstanceManager(async () => {
      throw new InvalidBackupError("bad archive");
    }),
    300,
  );

  await assert.rejects(
    () => manager.restoreUploadedBackup("user-1", restoreToken),
    InvalidBackupError,
  );
  assert.deepEqual(deleted, ["imports/user-1/backup.tar.gz"]);
});

function fakeStorage() {
  return {
    async createResumableUpload() {
      return "https://storage.example/upload";
    },
    async deleteObject() {
      throw new Error("delete should not be called");
    },
  };
}

function fakeInstanceManager(
  create: (
    userId: string,
    input: CreateInstanceInput,
  ) => Promise<Instance> = async () => ({} as Instance),
): InstanceManager {
  return { create } as unknown as InstanceManager;
}

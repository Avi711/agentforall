import { test } from "node:test";
import assert from "node:assert/strict";
import { BackupTransferTokenService } from "../src/services/backup-transfer-token.js";

const SECRET = "a".repeat(64);

test("backup import token binds object metadata", () => {
  const tokens = new BackupTransferTokenService([SECRET]);
  const token = tokens.createRestoreUploadToken({
    userId: "user-1",
    displayName: "Agent",
    objectName: "imports/user-1/backup.tar.gz",
    contentLength: 123,
    contentType: "application/gzip",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const grant = tokens.verifyImport(token);

  assert.deepEqual(grant, {
    userId: "user-1",
    displayName: "Agent",
    objectName: "imports/user-1/backup.tar.gz",
    contentLength: 123,
    contentType: "application/gzip",
  });
});

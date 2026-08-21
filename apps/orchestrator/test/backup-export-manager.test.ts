import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  BackupExportManager,
  type BackupExportStorage,
} from "../src/services/backup-export-manager.js";
import type { InstanceManager } from "../src/services/instance-manager.js";

test("backup export uploads stream and returns signed download URL", async () => {
  const uploads: string[] = [];
  const storage: BackupExportStorage = {
    async uploadObjectStream(input) {
      assert.equal(input.contentLength, 6);
      uploads.push(`${input.objectName}:${input.contentType}`);
      for await (const _chunk of input.body) {
        // drain stream
      }
    },
    async createReadSignedUrl(input) {
      assert.match(input.objectName, /^exports\/user-1\/instance-1\//);
      assert.equal(input.expiresInSeconds, 600);
      assert.equal(
        input.responseDisposition,
        'attachment; filename="agent-instance.tar.gz"',
      );
      return "https://storage.example/download";
    },
    async deleteObject() {
      throw new Error("delete should not be called");
    },
  };
  const manager = new BackupExportManager(
    fakeInstanceManager(Readable.from(["backup"]), 6, Promise.resolve()),
    storage,
  );

  const url = await manager.createDownloadUrl("instance-1", "user-1");

  assert.equal(url, "https://storage.example/download");
  assert.equal(uploads.length, 1);
  assert.match(uploads[0]!, /^exports\/user-1\/instance-1\/.+\.tar\.gz:application\/gzip$/);
});

test("backup export deletes partial object when streaming fails", async () => {
  const deleted: string[] = [];
  const storage: BackupExportStorage = {
    async uploadObjectStream(input) {
      for await (const _chunk of input.body) {
        // drain stream
      }
    },
    async createReadSignedUrl() {
      throw new Error("signing should not be called");
    },
    async deleteObject(objectName) {
      deleted.push(objectName);
    },
  };
  const manager = new BackupExportManager(
    fakeInstanceManager(
      Readable.from(["partial"]),
      7,
      Promise.reject(new Error("tar failed")),
    ),
    storage,
  );

  await assert.rejects(
    () => manager.createDownloadUrl("instance-1", "user-1"),
    /tar failed/,
  );
  assert.equal(deleted.length, 1);
  assert.match(deleted[0]!, /^exports\/user-1\/instance-1\/.+\.tar\.gz$/);
});

test("backup export job becomes ready without holding request open", async () => {
  const storage: BackupExportStorage = {
    async uploadObjectStream(input) {
      for await (const _chunk of input.body) {
        // drain stream
      }
    },
    async createReadSignedUrl() {
      return "https://storage.example/job-download";
    },
    async deleteObject() {
      throw new Error("delete should not be called");
    },
  };
  const manager = new BackupExportManager(
    fakeInstanceManager(Readable.from(["backup"]), 6, Promise.resolve()),
    storage,
  );

  const started = await manager.startDownloadJob("instance-1", "user-1");
  assert.equal(started.status, "pending");

  const ready = await waitForJob(manager, started.id);
  assert.equal(ready.status, "ready");
  if (ready.status === "ready") {
    assert.equal(ready.downloadUrl, "https://storage.example/job-download");
  }
});

function fakeInstanceManager(
  stdout: Readable,
  contentLength: number,
  done: Promise<void>,
): InstanceManager {
  return {
    async assertAgentBackupReadable() {
      // allowed
    },
    async exportAgentBackupStream() {
      return { stdout, contentLength, done };
    },
  } as unknown as InstanceManager;
}

async function waitForJob(
  manager: BackupExportManager,
  jobId: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = manager.getDownloadJob("instance-1", "user-1", jobId);
    if (job?.status !== "pending") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
}

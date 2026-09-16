import { test } from "node:test";
import assert from "node:assert/strict";
import type { Storage } from "@google-cloud/storage";
import { GcsBackupStorage } from "../src/services/gcs-backup-storage.js";

test("a bucket wired without an upload origin refuses to open a browser upload session", async () => {
  const storage = { bucket: () => ({}) } as unknown as Storage;
  const moves = new GcsBackupStorage("agent-forall-moves", null, storage);

  await assert.rejects(
    () => moves.createResumableUpload({ objectName: "x", contentType: "application/x-tar", contentLength: 1 }),
    /streamed uploads only/,
  );
});

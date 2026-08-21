import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import {
  buildOpenclawBackupCommand,
  rewrapOpenclawStateTarGzip,
  shouldExportOpenclawTopLevelEntry,
} from "../src/services/agent-runtime/openclaw/backup.js";

test("backup export includes durable OpenClaw state directories", () => {
  for (const name of [
    "agents",
    "cron",
    "delivery-queue",
    "devices",
    "flows",
    "identity",
    "media",
    "memory",
    "openclaw.json",
    "openclaw.json.bak",
    "plugin-skills",
    "plugins",
    "tasks",
    "workspace",
  ]) {
    assert.equal(shouldExportOpenclawTopLevelEntry(name), true, name);
  }
});

// WhatsApp device creds are secrets and bind the bot to one device; they are re-injected from the DB, never exported.
test("backup export excludes runtime-only, volatile and credential entries", () => {
  for (const name of [".env", "logs", "npm", "whatsapp-session"]) {
    assert.equal(shouldExportOpenclawTopLevelEntry(name), false, name);
  }
});

test("backup command exports top-level state by exclusion", () => {
  const command = buildOpenclawBackupCommand();

  assert.match(command, /find \. -mindepth 1 -maxdepth 1/);
  assert.match(command, /! -name \.env/);
  assert.match(command, /! -name logs/);
  assert.match(command, /! -name npm/);
  assert.match(command, /! -name whatsapp-session/);
  assert.doesNotMatch(command, /cron/);
});

test("backup command can write to a temp file with failure cleanup", () => {
  const command = buildOpenclawBackupCommand({ outputPath: "$tmp" });

  assert.match(command, /tar -czf "\$tmp" -T -/);
});

test("restore drops credential and runtime-only entries even when an archive carries them", async () => {
  const pack = tar.pack();
  pack.entry({ name: "./openclaw.json" }, "{}");
  pack.entry({ name: "./workspace/notes.md" }, "hello");
  pack.entry({ name: "./.env" }, "SECRET=1");
  pack.entry({ name: "./whatsapp-session/creds.json" }, "{\"noise\":1}");
  pack.entry({ name: "./logs/gateway.log" }, "…");
  pack.finalize();
  const archive = gzipSync(await collect(pack));

  const restored = await collect(rewrapOpenclawStateTarGzip(Readable.from([archive])));
  const names = await listTarEntries(restored);
  assert.deepEqual(names.sort(), [".openclaw/", ".openclaw/openclaw.json", ".openclaw/workspace/notes.md"]);
});

function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function listTarEntries(archive: Buffer): Promise<string[]> {
  const extract = tar.extract();
  const names: string[] = [];
  return new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      names.push(header.name);
      stream.on("end", next);
      stream.resume();
    });
    extract.on("finish", () => resolve(names));
    extract.on("error", reject);
    extract.end(archive);
  });
}

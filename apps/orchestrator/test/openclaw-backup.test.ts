import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import {
  buildOpenclawBackupFileCommand,
  parseOpenclawArchiveFile,
  rewrapOpenclawStateTarGzip,
} from "../src/services/agent-runtime/openclaw/backup.js";

// The runtime's own archiver is the only one that snapshots its SQLite stores consistently; the
// secrets it packs are stripped afterwards and the result verified again before it is served.
test("backup command lets the runtime archive, strips secrets, and re-verifies", () => {
  const command = buildOpenclawBackupFileCommand();

  assert.match(command, /openclaw backup create --output "\$dir" --verify --json/);
  assert.match(command, /python3 -c '[^]*payload\/posix\/home\/node\/\.openclaw\/[^]*' "\$src" "\$out"/);
  assert.match(command, /"\.env", "logs", "npm", "whatsapp-session"/);
  assert.match(command, /openclaw backup verify "\$out" --json/);
  // Over the cap the command fails while its cleanup trap still covers the archive.
  assert.match(command, /\[ "\$size" -le 536870912 \] && trap 'rm -rf "\$dir"' EXIT/);
  assert.match(command, /printf "%s\\n%s\\n" "\$out" "\$size"$/);
  // The temp directory goes; the archive itself is what the caller streams and removes.
  assert.match(command, /trap 'rm -rf "\$dir"' EXIT && printf/);
});

test("archive metadata is accepted only for the runtime's temp path", () => {
  assert.deepEqual(parseOpenclawArchiveFile("/tmp/openclaw-backup.abc123.tar.gz\n42\n"), {
    path: "/tmp/openclaw-backup.abc123.tar.gz",
    sizeBytes: 42,
  });
  assert.throws(() => parseOpenclawArchiveFile("/etc/passwd\n42\n"), /invalid backup archive metadata/);
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

// What `openclaw backup create` produces: a root directory holding the manifest and the state
// directory under payload/posix<absolute path>. Only the state directory is laid into the volume.
test("restore accepts the runtime's own archive layout", async () => {
  const root = "2026-09-02T10-00-00.000+03-00-openclaw-backup";
  const state = `${root}/payload/posix/home/node/.openclaw`;
  const pack = tar.pack();
  pack.entry({ name: `${root}/`, type: "directory" });
  pack.entry({ name: `${root}/manifest.json` }, "{}");
  pack.entry({ name: `${state}/`, type: "directory" });
  pack.entry({ name: `${state}/openclaw.json` }, "{}");
  pack.entry({ name: `${state}/state/openclaw.sqlite` }, "db");
  pack.entry({ name: `${state}/agents/main/agent/openclaw-agent.sqlite` }, "db");
  pack.entry({ name: `${state}/.env` }, "SECRET=1");
  pack.entry({ name: `${state}/whatsapp-session/creds.json` }, "{}");
  pack.finalize();
  const archive = gzipSync(await collect(pack));

  const restored = await collect(rewrapOpenclawStateTarGzip(Readable.from([archive])));
  const names = await listTarEntries(restored);
  assert.deepEqual(names.sort(), [
    ".openclaw/",
    ".openclaw/agents/main/agent/openclaw-agent.sqlite",
    ".openclaw/openclaw.json",
    ".openclaw/state/openclaw.sqlite",
  ]);
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

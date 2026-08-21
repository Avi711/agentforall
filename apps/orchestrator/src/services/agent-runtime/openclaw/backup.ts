import tar from "tar-stream";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { ContainerArchiveFile } from "../../container-runtime.js";
import {
  OPENCLAW_BACKUP_TIMEOUT_MS,
  OPENCLAW_MAX_BACKUP_BYTES,
  OPENCLAW_MAX_RESTORE_BYTES,
  OPENCLAW_MAX_RESTORE_ENTRIES,
  OPENCLAW_STATE_ROOT,
  OPENCLAW_USER,
} from "./constants.js";

const EXCLUDED_TOP_LEVEL_ENTRIES = new Set([".env", "logs", "npm"]);

export function buildOpenclawBackupCommand(
  opts: { outputPath?: string } = {},
): string {
  const output = opts.outputPath ? `"${opts.outputPath}"` : "-";
  return [
    `cd ${OPENCLAW_STATE_ROOT}`,
    "&&",
    "find . -mindepth 1 -maxdepth 1",
    "! -name .env ! -name logs ! -name npm",
    "-print 2>/dev/null",
    `| tar -czf ${output} -T -`,
  ].join(" ");
}

export function shouldExportOpenclawTopLevelEntry(name: string): boolean {
  return !EXCLUDED_TOP_LEVEL_ENTRIES.has(name);
}

export function buildOpenclawBackupFileCommand(): string {
  return [
    'tmp="$(mktemp /tmp/openclaw-backup.XXXXXX.tar.gz)"',
    'trap \'rm -f "$tmp"\' EXIT',
    buildOpenclawBackupCommand({ outputPath: "$tmp" }),
    'size="$(wc -c < "$tmp")"',
    "trap - EXIT",
    'printf "%s\\n%s\\n" "$tmp" "$size"',
  ].join(" && ");
}

export function parseOpenclawArchiveFile(output: string): ContainerArchiveFile {
  const [path, size] = output.trim().split(/\r?\n/);
  const sizeBytes = Number(size);
  if (!path?.startsWith("/tmp/openclaw-backup.") || !Number.isSafeInteger(sizeBytes)) {
    throw new Error("invalid backup archive metadata");
  }
  if (sizeBytes > OPENCLAW_MAX_BACKUP_BYTES) {
    throw new Error(`archive exceeds ${OPENCLAW_MAX_BACKUP_BYTES} bytes`);
  }
  return { path, sizeBytes };
}

export function rewrapOpenclawStateTarGzip(sourceTarGzip: Readable): Readable {
  const gunzip = createGunzip();
  const extract = tar.extract();
  const pack = tar.pack();
  let failed = false;
  let totalBytes = 0;
  let entries = 0;

  const fail = (err: Error) => {
    if (failed) return;
    failed = true;
    pack.destroy(err);
    extract.destroy(err);
    gunzip.destroy(err);
  };

  pack.entry(
    { name: ".openclaw/", type: "directory", mode: 0o755, ...OPENCLAW_USER },
    (err) => {
      if (err) fail(err);
    },
  );

  extract.on("entry", (header, stream, next) => {
    entries += 1;
    if (entries > OPENCLAW_MAX_RESTORE_ENTRIES) {
      stream.resume();
      fail(new Error("backup archive contains too many entries"));
      return;
    }

    if (!isSupportedArchiveEntry(header)) {
      stream.resume();
      fail(new Error(`backup archive contains unsupported entry type ${header.type}`));
      return;
    }

    const relative = normalizeOpenclawEntryName(header.name);
    if (!shouldRestoreOpenclawEntry(relative)) {
      stream.resume();
      next();
      return;
    }

    if (header.type === "file") {
      totalBytes += header.size ?? 0;
      if (totalBytes > OPENCLAW_MAX_RESTORE_BYTES) {
        stream.resume();
        fail(new Error("backup archive expands beyond restore limit"));
        return;
      }
    }

    const mapped = { ...header, name: `.openclaw/${relative}`, ...OPENCLAW_USER };

    stream.on("error", fail);
    stream.on("end", next);

    if (mapped.type === "symlink" && !isSafeLinkName(mapped.linkname)) {
      stream.resume();
      return;
    }

    const entry = pack.entry(mapped, (err) => {
      if (err) fail(err);
    });
    if (isMetadataOnlyEntry(header)) {
      stream.resume();
      entry.end();
      return;
    }
    stream.pipe(entry);
  });

  extract.on("finish", () => pack.finalize());
  extract.on("error", fail);
  gunzip.on("error", fail);
  sourceTarGzip.on("error", fail);
  sourceTarGzip.pipe(gunzip).pipe(extract);
  return pack;
}

export { OPENCLAW_BACKUP_TIMEOUT_MS };

function normalizeOpenclawEntryName(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const withoutRoot =
    normalized === ".openclaw" || normalized === ".openclaw/"
      ? ""
      : normalized.startsWith(".openclaw/")
        ? normalized.slice(".openclaw/".length)
        : normalized;
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    withoutRoot.includes("\0") ||
    withoutRoot.split("/").some((part) => part === "..")
  ) {
    throw new Error("backup archive contains an unsafe path");
  }
  return withoutRoot;
}

function isSupportedArchiveEntry(header: tar.Headers): boolean {
  return (
    header.type === "file" ||
    header.type === "directory" ||
    header.type === "symlink"
  );
}

function isMetadataOnlyEntry(header: tar.Headers): boolean {
  return header.type === "directory" || header.type === "symlink";
}

function isSafeLinkName(linkname: string | null | undefined): boolean {
  if (!linkname) return false;
  const normalized = linkname.replace(/\\/g, "/");
  return !(
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  );
}

function shouldRestoreOpenclawEntry(relative: string): boolean {
  const topLevel = relative.split("/")[0];
  return topLevel !== ".env";
}

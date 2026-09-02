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
  OPENCLAW_WHATSAPP_SESSION_DIR,
} from "./constants.js";

// WhatsApp device creds never travel with a backup: they are secrets in a user-downloadable file,
// and a restored bot booting with another bot's device would create a ghost session. Re-pair instead.
const EXCLUDED_TOP_LEVEL_ENTRIES = new Set([".env", "logs", "npm", OPENCLAW_WHATSAPP_SESSION_DIR]);
// Where `openclaw backup create` places the state directory inside its archive.
const ARCHIVE_STATE_PREFIX = `payload/posix${OPENCLAW_STATE_ROOT}/`;
const BACKUP_TMP_PREFIX = "/tmp/openclaw-backup.";

// The runtime archives (a raw copy of a live SQLite store is not restorable); we strip and re-verify.
export function buildOpenclawBackupFileCommand(): string {
  return [
    `out="$(mktemp ${BACKUP_TMP_PREFIX}XXXXXX.tar.gz)"`,
    `dir="$(mktemp -d ${BACKUP_TMP_PREFIX}XXXXXX.d)"`,
    "trap 'rm -rf \"$dir\" \"$out\"' EXIT",
    'openclaw backup create --output "$dir" --verify --json >/dev/null',
    'src="$(find "$dir" -maxdepth 1 -name \'*.tar.gz\' | head -n 1)"',
    '[ -n "$src" ]',
    // Cap before the rewrite: a second full copy of an oversized archive is what fills the disk.
    `[ "$(wc -c < "$src")" -le ${OPENCLAW_MAX_BACKUP_BYTES} ]`,
    `python3 -c ${shellQuote(stripSecretsScript())} "$src" "$out"`,
    'openclaw backup verify "$out" --json >/dev/null',
    'size="$(wc -c < "$out")"',
    `[ "$size" -le ${OPENCLAW_MAX_BACKUP_BYTES} ]`,
    // The archive outlives the command: the caller streams it, then removes it.
    "trap 'rm -rf \"$dir\"' EXIT",
    'printf "%s\\n%s\\n" "$out" "$size"',
  ].join(" && ");
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

// tarfile copies members header-for-header; tar(1) cannot delete from a gzip stream.
function stripSecretsScript(): string {
  const excluded = [...EXCLUDED_TOP_LEVEL_ENTRIES].map((name) => JSON.stringify(name)).join(", ");
  return [
    "import sys, tarfile",
    `prefix = ${JSON.stringify(ARCHIVE_STATE_PREFIX)}`,
    `excluded = {${excluded}}`,
    "def secret(name):",
    "    idx = name.find(prefix)",
    "    if idx < 0:",
    "        return False",
    "    return name[idx + len(prefix):].split('/', 1)[0] in excluded",
    "with tarfile.open(sys.argv[1], 'r:gz') as src, tarfile.open(sys.argv[2], 'w:gz') as dst:",
    "    for member in src:",
    "        if secret(member.name):",
    "            continue",
    "        dst.addfile(member, src.extractfile(member) if member.isfile() else None)",
  ].join("\n");
}

export function parseOpenclawArchiveFile(output: string): ContainerArchiveFile {
  const [path, size] = output.trim().split(/\r?\n/);
  const sizeBytes = Number(size);
  if (!path?.startsWith(BACKUP_TMP_PREFIX) || !Number.isSafeInteger(sizeBytes)) {
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
    // "" is the state directory itself, which the leading entry already provides.
    if (relative === null || relative === "" || !shouldRestoreOpenclawEntry(relative)) {
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

// Runtime archive (`<root>/payload/posix<state dir>/**`) or the older flat tarball; null = not state.
function normalizeOpenclawEntryName(name: string): string | null {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("backup archive contains an unsafe path");
  }
  const payload = normalized.indexOf(ARCHIVE_STATE_PREFIX);
  if (payload >= 0) return normalized.slice(payload + ARCHIVE_STATE_PREFIX.length);
  if (isRuntimeArchiveEntry(normalized)) return null;
  if (normalized === ".openclaw" || normalized === ".openclaw/") return "";
  return normalized.startsWith(".openclaw/") ? normalized.slice(".openclaw/".length) : normalized;
}

// The runtime names its archive root "<timestamp>-openclaw-backup"; that directory is not state.
function isRuntimeArchiveEntry(name: string): boolean {
  const parts = name.replace(/\/+$/, "").split("/");
  if (parts.length === 1) return (parts[0] ?? "").endsWith("-openclaw-backup");
  return parts[1] === "manifest.json" || parts[1] === "payload";
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

// Same exclusions on restore, so a hand-built or older archive can't smuggle them back in.
function shouldRestoreOpenclawEntry(relative: string): boolean {
  const topLevel = relative.split("/")[0] ?? "";
  return !EXCLUDED_TOP_LEVEL_ENTRIES.has(topLevel);
}

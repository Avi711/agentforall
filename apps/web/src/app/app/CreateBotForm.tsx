"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { CreatingPanel } from "./CreatingPanel";
import { ConnectChannelStep } from "./ConnectChannelStep";
import { SurfaceCard } from "./Marks";
import { InstanceSchema } from "@/lib/orchestrator/types";
import { toBotSnapshot, type BotSnapshot } from "@/lib/bots/snapshot";
import {
  buildTimeline,
  mergeHistory,
  type CreationStep,
  type CreationTimelineEntry,
  type ProvisioningEvent,
} from "@/lib/bots/creation-progress";

const MAX_BACKUP_FILE_BYTES = 512 * 1024 * 1024;
const DEFAULT_BACKUP_CONTENT_TYPE = "application/gzip";
const BACKUP_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_ATTEMPTS = 3;
const READY_POLL_MS = 2_000;
// Health-gated `running` lands ~20s after create; past this we stop waiting and show the real status.
const READY_TIMEOUT_MS = 180_000;
const READY_BEAT_MS = 900;
const PROVISION_FAILED_HE = "לא הצלחנו להעלות את הסוכן. נסו שוב; אם זה חוזר — דברו איתנו.";

interface CreatingState {
  kind: "creating";
  name: string;
  restoring: boolean;
  // Client-side steps (register / upload / restore) with client timestamps.
  local: CreationTimelineEntry[];
  // Orchestrator stages with server timestamps, refreshed on every poll.
  history: ProvisioningEvent[];
  rowKnownAt: number | null;
  readyAt: number | null;
  uploadPercent: number | null;
  ready: boolean;
  failure: string | null;
  // Set once the orchestrator row exists; a retry removes it first so it doesn't linger in `error`.
  botId: string | null;
}

type Phase = { kind: "form" } | CreatingState | { kind: "connect"; name: string };

export function CreateBotForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const unmounted = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const mountedPhase = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Keep the card in view when its content changes (the panels differ a lot in height).
  useEffect(() => {
    if (!mountedPhase.current) {
      mountedPhase.current = true;
      return;
    }
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase.kind]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void startCreation(displayName.trim(), backupFile, null);
  }

  async function startCreation(name: string, file: File | null, previousBotId: string | null) {
    const restoring = file !== null;
    const patch = (update: (prev: CreatingState) => CreatingState) => {
      if (unmounted.current) return;
      setPhase((prev) => (prev.kind === "creating" ? update(prev) : prev));
    };
    const closeLocal = (prev: CreatingState, now: number): CreationTimelineEntry[] =>
      prev.local.map((t, i) => (i === prev.local.length - 1 && t.endedAt === null ? { ...t, endedAt: now } : t));
    const enter = (step: CreationStep) =>
      patch((prev) => {
        const now = Date.now();
        return { ...prev, local: [...closeLocal(prev, now), { id: step, startedAt: now, endedAt: null }], uploadPercent: null };
      });
    const report = (step: CreationStep, uploadPercent: number) =>
      patch((prev) => (prev.local.at(-1)?.id === step ? { ...prev, uploadPercent } : prev));

    setError(null);
    setPhase({
      kind: "creating",
      name,
      restoring,
      local: [],
      history: [],
      rowKnownAt: null,
      readyAt: null,
      uploadPercent: null,
      ready: false,
      failure: null,
      botId: null,
    });
    enter(restoring ? "uploading" : "registering");

    try {
      if (previousBotId) await deleteBot(previousBotId);
      const botId = file
        ? await createBotFromBackup(name, file, { enter, report })
        : await createBot(name);
      patch((prev) => {
        const now = Date.now();
        return { ...prev, botId, rowKnownAt: now, local: closeLocal(prev, now), uploadPercent: null };
      });
      const ready = await waitUntilReady(botId, {
        cancelled: () => unmounted.current,
        onProgress: (bot) =>
          patch((prev) => ({ ...prev, history: mergeHistory(prev.history, bot.provisioningHistory) })),
      });
      if (unmounted.current) return;
      if (ready === "error") throw new Error(PROVISION_FAILED_HE);
      if (ready === "timeout") {
        // Past the wait budget: the dashboard card shows the real status.
        router.refresh();
        return;
      }
      patch((prev) => ({ ...prev, ready: true, readyAt: Date.now() }));
      await sleep(READY_BEAT_MS);
      if (unmounted.current) return;
      if (restoring) {
        // Restored bots already carry their channels.
        router.refresh();
        return;
      }
      setPhase({ kind: "connect", name });
    } catch (err) {
      if (unmounted.current) return;
      const message = err instanceof Error ? err.message : UNEXPECTED_ERROR_HE;
      setPhase((prev) =>
        prev.kind === "creating" ? { ...prev, failure: message } : prev,
      );
    }
  }

  function selectBackupFile(file: File | null): void {
    if (!file) {
      setBackupFile(null);
      return;
    }
    if (!isBackupArchive(file)) {
      setError("אפשר להעלות רק קובץ .tar.gz או .tgz");
      return;
    }
    setError(null);
    setBackupFile(file);
    setRestoreOpen(true);
  }

  function handleRestoreDrag(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    if (e.type === "dragleave") setDragActive(false);
  }

  function handleRestoreDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    selectBackupFile(e.dataTransfer.files.item(0));
  }

  const createLabel = backupFile ? "יצירת סוכן מגיבוי" : "יצירת סוכן";

  return (
    <SurfaceCard cardRef={cardRef} className="scroll-mt-6 p-5 sm:p-12">
      {phase.kind === "creating" ? (
        <div key="creating" className="animate-fade-up">
          <CreatingPanel
            name={phase.name}
            restoring={phase.restoring}
            timeline={buildTimeline(phase)}
            uploadPercent={phase.uploadPercent}
            ready={phase.ready}
            failure={phase.failure}
            onRetry={() => void startCreation(phase.name, backupFile, phase.botId)}
          />
        </div>
      ) : phase.kind === "connect" ? (
        <div key="connect" className="animate-fade-up">
          <ConnectChannelStep name={phase.name} onLater={() => router.refresh()} />
        </div>
      ) : (
        <div key="form" className="animate-fade-up">
          <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">התחלה</p>
          <h2 className="font-display text-2xl sm:text-3xl text-espresso mb-3 leading-tight">
            בואו ניצור לכם סוכן
          </h2>
          <p className="text-espresso-light max-w-md mb-8 leading-relaxed">
            תוך דקות יהיה לכם עוזר אישי בטלגרם או בוואטסאפ — שמכיר אתכם, זוכר את
            התזכורות, ומגיב 24/7.
          </p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="block text-sm text-espresso-light mb-1.5">
                איך הסוכן שלכם ייקרא?
              </span>
              <input
                type="text"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="לדוגמה: ג׳ארוויס, שלומי, אלפרד"
                className="w-full px-4 py-3 rounded-xl border border-sand bg-white text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale"
              />
            </label>

            <div className="rounded-2xl border border-sand-light/80 bg-cream/55 overflow-hidden">
              <button
                type="button"
                aria-expanded={restoreOpen}
                onClick={() => setRestoreOpen((value) => !value)}
                className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-start text-espresso hover:bg-cream-dark/55 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-inset"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">יש לכם קובץ גיבוי?</span>
                  <span className="block mt-0.5 text-xs text-espresso-light">
                    שחזור OpenClaw קיים במקום יצירה נקייה
                  </span>
                </span>
                <ChevronDownIcon open={restoreOpen} />
              </button>

              {restoreOpen ? (
                <div className="border-t border-sand-light/70 px-4 py-4">
                  <label
                    onDragEnter={handleRestoreDrag}
                    onDragOver={handleRestoreDrag}
                    onDragLeave={handleRestoreDrag}
                    onDrop={handleRestoreDrop}
                    className={`block rounded-2xl border border-dashed px-4 py-4 cursor-pointer transition ${
                      dragActive
                        ? "border-terra bg-terra-pale/80 text-terra"
                        : "border-sand bg-white/70 hover:border-terra-light hover:bg-white text-espresso"
                    }`}
                  >
                    <input
                      type="file"
                      accept=".gz,.tgz,application/gzip,application/x-gzip"
                      onChange={(e) => selectBackupFile(e.target.files?.[0] ?? null)}
                      className="sr-only"
                    />
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cream-dark text-terra">
                        <UploadIcon />
                      </span>
                      <div className="min-w-0 text-sm">
                        <span className="block font-medium">
                          {backupFile
                            ? "קובץ הגיבוי נבחר"
                            : "גררו לכאן קובץ גיבוי או לחצו לבחירה"}
                        </span>
                        <span className="block mt-0.5 text-xs text-espresso-light">
                          קובץ .tar.gz או .tgz שהורדתם מהסוכן הקודם
                        </span>
                      </div>

                      {backupFile ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:ms-auto sm:justify-end text-sm">
                          <span className="max-w-full sm:max-w-[14rem] truncate font-medium text-espresso">
                            {backupFile.name}
                          </span>
                          <span className="text-xs text-espresso-light">
                            {formatFileSize(backupFile.size)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              selectBackupFile(null);
                            }}
                            className="text-xs font-medium text-terra hover:text-terra-light transition"
                          >
                            הסרה
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="flex justify-stretch sm:justify-end">
              <button
                type="submit"
                disabled={displayName.trim().length === 0}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-terra text-white font-medium hover:bg-terra-light transition disabled:opacity-50"
              >
                {createLabel}
              </button>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {error}
              </p>
            ) : null}
          </form>
        </div>
      )}
    </SurfaceCard>
  );
}

async function createBot(displayName: string): Promise<string> {
  const res = await fetch("/api/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(codeToHe(errorCode(data)) ?? UNEXPECTED_ERROR_HE);
  }
  return botIdOf(data);
}

type ReadyOutcome = "running" | "error" | "timeout";

// Resolves once the orchestrator promotes the bot (health-gated), or when the bot fails to come up.
async function waitUntilReady(
  botId: string,
  hooks: { cancelled: () => boolean; onProgress: (bot: BotSnapshot) => void },
): Promise<ReadyOutcome> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(READY_POLL_MS);
    if (hooks.cancelled()) return "timeout";
    const res = await fetch(`/api/bot/${botId}`, { cache: "no-store" }).catch(() => null);
    // The bot vanished or the session ended: waiting longer cannot succeed.
    if (res && (res.status === 404 || res.status === 401)) return "error";
    if (!res || !res.ok) continue;
    const bot = botOf(await res.json().catch(() => null));
    if (!bot) continue;
    hooks.onProgress(bot);
    if (bot.status === "running") return "running";
    if (bot.status === "error") return "error";
  }
  return "timeout";
}

function botOf(data: unknown): BotSnapshot | null {
  const parsed = InstanceSchema.safeParse((data as { bot?: unknown } | null)?.bot);
  return parsed.success ? toBotSnapshot(parsed.data) : null;
}

function botIdOf(data: unknown): string {
  const bot = botOf(data);
  if (!bot) throw new Error(UNEXPECTED_ERROR_HE);
  return bot.id;
}

async function deleteBot(botId: string): Promise<void> {
  // Best effort: a failed row that survives is hidden from the dashboard and cleaned up by support.
  await fetch(`/api/bot/${botId}`, { method: "DELETE" }).catch(() => undefined);
}

async function createBotFromBackup(
  displayName: string,
  backupFile: File,
  progress: { enter: (step: CreationStep) => void; report: (step: CreationStep, uploadPercent: number) => void },
): Promise<string> {
  if (backupFile.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error("קובץ הגיבוי גדול מדי.");
  }

  const contentType = DEFAULT_BACKUP_CONTENT_TYPE;
  const sessionRes = await fetch("/api/bot/import-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName,
      contentLength: backupFile.size,
      contentType,
    }),
  });
  const sessionData: unknown = await sessionRes.json().catch(() => null);
  if (!sessionRes.ok || !isBackupUploadSession(sessionData)) {
    throw new Error(codeToHe(errorCode(sessionData)) ?? UNEXPECTED_ERROR_HE);
  }

  await uploadBackupFile(sessionData.uploadUrl, backupFile, contentType, (percent) =>
    progress.report("uploading", percent),
  );
  progress.enter("restoring");

  const restoreRes = await fetch("/api/bot/import-complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ restoreToken: sessionData.restoreToken }),
  });
  const restoreData: unknown = await restoreRes.json().catch(() => null);
  if (!restoreRes.ok) {
    throw new Error(codeToHe(errorCode(restoreData)) ?? UNEXPECTED_ERROR_HE);
  }
  return botIdOf(restoreData);
}

function isBackupUploadSession(
  data: unknown,
): data is { uploadUrl: string; restoreToken: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "uploadUrl" in data &&
    typeof (data as { uploadUrl?: unknown }).uploadUrl === "string" &&
    "restoreToken" in data &&
    typeof (data as { restoreToken?: unknown }).restoreToken === "string"
  );
}

async function uploadBackupFile(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  let offset = 0;
  onProgress(0);
  while (offset < file.size) {
    const endExclusive = Math.min(offset + BACKUP_UPLOAD_CHUNK_BYTES, file.size);
    const chunk = file.slice(offset, endExclusive, contentType);
    offset = await uploadBackupChunk({
      uploadUrl,
      chunk,
      contentType,
      totalSize: file.size,
      offset,
      endExclusive,
    });
    onProgress(Math.min(100, Math.round((offset / file.size) * 100)));
  }
}

async function uploadBackupChunk(input: {
  uploadUrl: string;
  chunk: Blob;
  contentType: string;
  totalSize: number;
  offset: number;
  endExclusive: number;
}): Promise<number> {
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    const res = await fetch(input.uploadUrl, {
      method: "PUT",
      headers: {
        "content-range": `bytes ${input.offset}-${input.endExclusive - 1}/${input.totalSize}`,
        "content-type": input.contentType,
      },
      body: input.chunk,
    });
    if (res.ok) return input.endExclusive;
    if (res.status === 308) {
      const committed = committedBytes(res.headers.get("range"));
      if (committed > input.offset) return committed;
    }
    if (attempt === MAX_UPLOAD_ATTEMPTS || !isTransientUploadStatus(res.status)) {
      throw new Error(UNEXPECTED_ERROR_HE);
    }
    await sleep(150 * 2 ** (attempt - 1));
  }
  throw new Error(UNEXPECTED_ERROR_HE);
}

function isBackupArchive(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".tar.gz") ||
    name.endsWith(".tgz") ||
    file.type === "application/gzip" ||
    file.type === "application/x-gzip"
  );
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)}KB`;
  return `${Math.ceil(size / (1024 * 1024))}MB`;
}

function committedBytes(range: string | null): number {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  return match ? Number(match[1]) + 1 : 0;
}

function isTransientUploadStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorCode(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  if ("code" in data && typeof (data as { code?: unknown }).code === "string") {
    return (data as { code: string }).code;
  }
  if (
    "error" in data &&
    typeof (data as { error?: unknown }).error === "object" &&
    (data as { error?: unknown }).error !== null
  ) {
    const error = (data as { error: { code?: unknown } }).error;
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

function codeToHe(code: string | undefined): string | undefined {
  switch (code) {
    case "orchestrator_unavailable":
      return "השרת לא זמין כרגע. נסו בעוד רגע.";
    case "invalid_body":
      return "פרטים לא תקינים";
    default:
      return undefined;
  }
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-5 w-5 shrink-0 text-espresso-light transition ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M10 14V4M6.5 7.5 10 4l3.5 3.5M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

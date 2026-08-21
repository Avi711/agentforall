import { finished } from "node:stream/promises";
import { pack } from "tar-fs";
import type { FastifyBaseLogger } from "fastify";

export interface CompletionOptions {
  orchestratorBaseUrl: string;
  serviceToken: string;
  instanceId: string;
  sessionDir: string;
  accountId: string | undefined;
  log: FastifyBaseLogger;
}

// Healthy Baileys auth state is <2 MB; 8 MB cap catches pathological input.
const MAX_TAR_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

class NonRetryableCompletionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "NonRetryableCompletionError";
  }
}

// Retries transient 5xx/network; 4xx propagates immediately.
export async function notifyOrchestratorOfCompletion(
  opts: CompletionOptions,
): Promise<void> {
  const blob = await tarDirectoryToBuffer(opts.sessionDir);
  if (blob.length === 0) {
    throw new Error("tar produced empty blob — session dir likely missing files");
  }

  const url = new URL(
    `/internal/pair/${encodeURIComponent(opts.instanceId)}/completed`,
    opts.orchestratorBaseUrl,
  );

  await postWithRetry(url, blob, opts);
  opts.log.info({ bytes: blob.length }, "creds tar uploaded to orchestrator");
}

async function tarDirectoryToBuffer(dir: string): Promise<Buffer> {
  const tarStream = pack(dir, { dereference: false });
  const chunks: Buffer[] = [];
  let bytes = 0;

  tarStream.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_TAR_BYTES) {
      tarStream.destroy(
        new Error(`tar exceeded ${MAX_TAR_BYTES} bytes — refusing to upload`),
      );
      return;
    }
    chunks.push(chunk);
  });

  await finished(tarStream);
  return Buffer.concat(chunks);
}

async function postWithRetry(
  url: URL,
  blob: Buffer,
  opts: CompletionOptions,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await postOnce(url, blob, opts);
      return;
    } catch (err) {
      if (err instanceof NonRetryableCompletionError) throw err;
      lastError = err;
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      opts.log.warn(
        { attempt, delay, err: lastError },
        "completion POST failed — will retry",
      );
      await sleep(delay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("completion POST failed after retries");
}

async function postOnce(
  url: URL,
  blob: Buffer,
  opts: CompletionOptions,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      authorization: `Bearer ${opts.serviceToken}`,
      "x-account-id": opts.accountId ?? "",
      "x-instance-id": opts.instanceId,
    },
    body: new Uint8Array(blob),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (res.ok) return;

  if (res.status >= 400 && res.status < 500) {
    const body = await res.text().catch(() => "");
    throw new NonRetryableCompletionError(
      res.status,
      `orchestrator rejected completion: ${res.status} ${res.statusText} ${body}`,
    );
  }

  throw new Error(`orchestrator ${res.status} ${res.statusText}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

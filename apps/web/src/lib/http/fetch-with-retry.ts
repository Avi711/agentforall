const MAX_RETRY_AFTER_MS = 5_000;

export interface RetryOptions {
  attempts: number;
  timeoutMs: number;
  backoffMs: number;
  fetch?: typeof fetch;
}

// Only for idempotent requests.
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const send = options.fetch ?? fetch;
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= options.attempts;
    let waitMs = options.backoffMs * 2 ** (attempt - 1) + Math.random() * options.backoffMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await send(url, { ...init, signal: controller.signal });
      if (last || !isRetryable(res.status)) return res;
      // Retrying before the server's Retry-After only extends the block; a long one is not worth holding the caller for.
      const retryAfterMs = Number(res.headers.get("retry-after")) * 1000;
      if (retryAfterMs > MAX_RETRY_AFTER_MS) return res;
      if (retryAfterMs > waitMs) waitMs = retryAfterMs;
      await res.body?.cancel();
    } catch (err) {
      if (last) throw err;
    } finally {
      clearTimeout(timer);
    }
    await sleep(waitMs);
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

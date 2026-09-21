export interface RetryOptions {
  attempts: number;
  timeoutMs: number;
  backoffMs: number;
}

// Retries network errors, timeouts, 429 and 5xx; any other answer is final. Only for idempotent requests.
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= options.attempts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (last || !isRetryable(res.status)) return res;
      await res.body?.cancel();
    } catch (err) {
      if (last) throw err;
    } finally {
      clearTimeout(timer);
    }
    await sleep(options.backoffMs * 2 ** (attempt - 1) + Math.random() * options.backoffMs);
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

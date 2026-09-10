import { z } from "zod";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 200;

const TokenResponse = z.object({ access_token: z.string().min(1) });

export class MetaOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "MetaOAuthError";
  }
}

export interface MetaOAuthClient {
  exchangeCode(code: string): Promise<string>;
}

// Turns the popup's short-lived code into the client's business token; the app secret never leaves this call.
export class MetaGraphOAuth implements MetaOAuthClient {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly apiVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async exchangeCode(code: string): Promise<string> {
    const params = new URLSearchParams({ client_id: this.appId, client_secret: this.appSecret, code });
    const url = `https://graph.facebook.com/${this.apiVersion}/oauth/access_token?${params}`;
    let lastError: MetaOAuthError = new MetaOAuthError(0, null, "no attempt");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const text = await res.text();
        if (res.ok) {
          const parsed = TokenResponse.safeParse(safeJson(text));
          if (parsed.success) return parsed.data.access_token;
          throw new MetaOAuthError(res.status, null, "unexpected token response");
        }
        lastError = new MetaOAuthError(res.status, errorCodeOf(text), this.redact(text.slice(0, 200)));
        // A code is single-use and 30s old: only a transient failure is worth a second try.
        if (res.status < 500 && res.status !== 429) throw lastError;
      } catch (err) {
        if (err instanceof MetaOAuthError && err.status !== 0 && err.status < 500 && err.status !== 429) throw err;
        lastError = err instanceof MetaOAuthError ? err : new MetaOAuthError(0, null, this.redact(String(err)));
      }
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS + Math.random() * RETRY_BACKOFF_MS);
    }
    throw lastError;
  }

  private redact(text: string): string {
    return text.split(this.appSecret).join("[redacted]");
  }
}

function errorCodeOf(text: string): number | null {
  const parsed = z.object({ error: z.object({ code: z.number() }) }).safeParse(safeJson(text));
  return parsed.success ? parsed.data.error.code : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

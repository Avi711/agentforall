const REQUEST_TIMEOUT_MS = 15_000;
const LONG_POLL_GRACE_MS = 5_000;

export class RelayError extends Error {
  constructor(status, code, message) {
    super(message ?? `relay ${status}${code ? ` ${code}` : ""}`);
    this.name = "RelayError";
    this.status = status;
    this.code = code;
  }
}

// What a log line may say about an error: an orchestrator message can name a customer's number, so only status and code.
export function errorLabel(err) {
  if (err instanceof RelayError) return `relay ${err.status}${err.code ? ` ${err.code}` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

// The container's only connection to the outside: one bearer, one base URL, no Meta credential.
export class RelayClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    if (!baseUrl || !token) throw new Error("relay baseUrl and token are required");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async pull(waitMs, signal) {
    const res = await this.request("GET", `/inbox?wait=${waitMs}`, undefined, {
      timeoutMs: waitMs + LONG_POLL_GRACE_MS,
      signal,
    });
    return Array.isArray(res?.items) ? res.items : [];
  }

  async ack(ids) {
    if (ids.length === 0) return 0;
    const res = await this.request("POST", "/inbox/ack", { ids });
    return typeof res?.acked === "number" ? res.acked : 0;
  }

  async sendText({ to, text, replyToId, kind }) {
    const res = await this.request("POST", "/send", {
      to,
      text,
      ...(replyToId ? { replyToId } : {}),
      ...(kind ? { kind } : {}),
    });
    if (typeof res?.wamid !== "string") throw new RelayError(200, "EMPTY_RESPONSE", "relay accepted the send without a wamid");
    return res.wamid;
  }

  async markRead(wamid, typing) {
    await this.request("POST", "/read", { wamid, typing });
  }

  async escalate(waId, summary, kind = "request") {
    const res = await this.request("POST", "/escalate", { waId, summary, kind });
    return { notified: Boolean(res?.notified), fallbackToBot: Boolean(res?.fallbackToBot) };
  }

  async conversation(waId) {
    const res = await this.request("GET", `/conversations/${encodeURIComponent(waId)}`);
    return res?.conversation ?? null;
  }

  async setMode(waId, mode) {
    const res = await this.request("POST", `/conversations/${encodeURIComponent(waId)}/mode`, { mode });
    if (!res?.conversation) throw new RelayError(200, "EMPTY_RESPONSE", "relay changed the mode without returning it");
    return res.conversation;
  }

  async request(method, path, body, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? safeJson(text) : null;
      if (!res.ok) throw new RelayError(res.status, json?.code ?? null, json?.message ?? undefined);
      return json;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

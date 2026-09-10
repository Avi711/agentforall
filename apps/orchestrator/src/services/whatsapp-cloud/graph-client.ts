import { TransformStream as WebTransformStream, type ReadableStream as WebReadableStream } from "node:stream/web";
import { z } from "zod";
import type { MediaLocation, PhoneNumberFacts } from "../../domain/whatsapp-cloud.js";
import { MEDIA_MAX_BYTES } from "../../domain/whatsapp-cloud.js";

const REQUEST_TIMEOUT_MS = 15_000;
// Headers and, later, every gap between body chunks: a stalled CDN never pins a socket for good.
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;

// 190 dead token, 10 permission denied, 102 session invalid, 200-299 permission errors: the app lost the WABA.
export const META_CREDENTIAL_CODES: ReadonlySet<number> = new Set([190, 10, 102, ...Array.from({ length: 100 }, (_, i) => 200 + i)]);
export const META_ERROR_REENGAGEMENT = 131047;
export const META_ERROR_PIN_MISMATCH = 133005;
// 130429 rate limit, 131056 pair rate, 80007 throughput, 131048 spam rate, 4/17/32/613 app and user limits: "later", not "no".
export const META_THROTTLE_CODES: ReadonlySet<number> = new Set([130429, 131056, 80007, 131048, 4, 17, 32, 613]);
// Media URLs Meta hands out live on its own CDN; the bearer goes nowhere else.
const MEDIA_HOST_SUFFIXES = [".fbsbx.com", ".whatsapp.net", ".facebook.com", ".fbcdn.net"];

const ErrorEnvelope = z.object({
  error: z.object({
    message: z.string(),
    code: z.number().int(),
    fbtrace_id: z.string().optional(),
  }),
});
const Success = z.object({ success: z.boolean() });
const SendResponse = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });
const PhoneNumber = z.object({
  display_phone_number: z.string(),
  verified_name: z.string().default(""),
});
const Media = z.object({
  url: z.string().url(),
  mime_type: z.string(),
});

export class MetaGraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    readonly path: string,
    message: string,
  ) {
    super(`meta graph ${path} -> ${status}${code === null ? "" : ` (code ${code})`}: ${message}`);
    this.name = "MetaGraphError";
  }
}

export interface MediaDownload {
  contentType: string;
  body: WebReadableStream<Uint8Array>;
}

export interface SendTextRequest {
  to: string;
  text: string;
  replyToId?: string;
}

// One client for every tenant; the token is per call because every WABA has its own.
export class MetaGraphClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async subscribeApp(wabaId: string, token: string): Promise<void> {
    Success.parse(await this.request("POST", `${wabaId}/subscribed_apps`, token, undefined, { retry: true }));
  }

  async unsubscribeApp(wabaId: string, token: string): Promise<void> {
    Success.parse(await this.request("DELETE", `${wabaId}/subscribed_apps`, token, undefined, { retry: true }));
  }

  async registerNumber(phoneNumberId: string, token: string, pin: string): Promise<void> {
    Success.parse(
      await this.request("POST", `${phoneNumberId}/register`, token, { messaging_product: "whatsapp", pin }, { retry: true }),
    );
  }

  async deregisterNumber(phoneNumberId: string, token: string): Promise<void> {
    Success.parse(await this.request("POST", `${phoneNumberId}/deregister`, token, undefined, { retry: true }));
  }

  async getPhoneNumber(phoneNumberId: string, token: string): Promise<PhoneNumberFacts> {
    const params = new URLSearchParams({ fields: "display_phone_number,verified_name" });
    const parsed = PhoneNumber.parse(await this.request("GET", `${phoneNumberId}?${params}`, token, undefined, { retry: true }));
    return { displayPhoneNumber: normalizeDisplayNumber(parsed.display_phone_number), verifiedName: parsed.verified_name };
  }

  // Not retried: a second attempt after an ambiguous failure would be a second message.
  async sendText(phoneNumberId: string, token: string, req: SendTextRequest): Promise<string> {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: req.to,
      type: "text",
      text: { preview_url: false, body: req.text },
      ...(req.replyToId ? { context: { message_id: req.replyToId } } : {}),
    };
    const parsed = SendResponse.parse(await this.request("POST", `${phoneNumberId}/messages`, token, body));
    return parsed.messages[0]!.id;
  }

  async markRead(phoneNumberId: string, token: string, wamid: string, typing: boolean): Promise<void> {
    const body = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: wamid,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    };
    Success.parse(await this.request("POST", `${phoneNumberId}/messages`, token, body, { retry: true }));
  }

  async getMediaLocation(mediaId: string, token: string): Promise<MediaLocation> {
    const parsed = Media.parse(await this.request("GET", mediaId, token, undefined, { retry: true }));
    return { url: parsed.url, mimeType: parsed.mime_type };
  }

  // Media URLs are short-lived and only answer with the same bearer that looked them up.
  async downloadMedia(location: MediaLocation, token: string, signal?: AbortSignal): Promise<MediaDownload> {
    if (!isMetaMediaHost(location.url)) {
      throw new MetaGraphError(403, null, `media:${hostOf(location.url)}`, "media url is not on Meta's CDN");
    }
    const download = new AbortController();
    const abort = () => download.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let timer = setTimeout(abort, DOWNLOAD_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(location.url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: download.signal,
        redirect: "manual",
      });
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      throw err;
    }
    clearTimeout(timer);
    if (!res.ok || !res.body) {
      signal?.removeEventListener("abort", abort);
      throw new MetaGraphError(res.status, null, "media", await res.text().catch(() => ""));
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MEDIA_MAX_BYTES) {
      abort();
      signal?.removeEventListener("abort", abort);
      throw new MetaGraphError(413, null, "media", "media larger than the cap");
    }
    let seen = 0;
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const guard = new WebTransformStream<Uint8Array, Uint8Array>({
      start() {
        timer = setTimeout(abort, DOWNLOAD_TIMEOUT_MS);
      },
      transform(chunk, controller) {
        clearTimeout(timer);
        timer = setTimeout(abort, DOWNLOAD_TIMEOUT_MS);
        seen += chunk.byteLength;
        // A Content-Length can lie; the stream itself stops at the cap.
        if (seen > MEDIA_MAX_BYTES) {
          settle();
          abort();
          controller.error(new MetaGraphError(413, null, "media", "media larger than the cap"));
          return;
        }
        controller.enqueue(chunk);
      },
      flush: settle,
      // The consumer hung up: nothing must outlive the download, not the timer, not the listener, not the socket.
      cancel() {
        settle();
        abort();
      },
    });
    // fetch types the body as the DOM stream; at runtime it is Node's, which Readable.fromWeb wants.
    const body = (res.body as unknown as WebReadableStream<Uint8Array>).pipeThrough(guard);
    return { contentType: res.headers.get("content-type") ?? location.mimeType, body };
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    token: string,
    body?: unknown,
    opts: { retry?: boolean } = {},
  ): Promise<unknown> {
    const attempts = opts.retry ? MAX_ATTEMPTS : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      try {
        return await this.requestOnce(method, path, token, body);
      } catch (err) {
        lastError = err;
        if (!isTransient(err)) throw err;
      }
    }
    throw lastError;
  }

  private async requestOnce(method: string, path: string, token: string, body: unknown): Promise<unknown> {
    const url = new URL(`${this.apiVersion}/${path}`, ensureTrailingSlash(this.baseUrl));
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw toGraphError(res.status, path, text);
    return text ? (JSON.parse(text) as unknown) : null;
  }
}

function toGraphError(status: number, path: string, text: string): MetaGraphError {
  try {
    const parsed = ErrorEnvelope.parse(JSON.parse(text));
    return new MetaGraphError(status, parsed.error.code, path, parsed.error.message);
  } catch {
    return new MetaGraphError(status, null, path, text.slice(0, 200) || "no body");
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof MetaGraphError) return err.status === 429 || err.status >= 500;
  return true;
}

function isMetaMediaHost(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && MEDIA_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

function normalizeDisplayNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : raw;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { CapiConfig } from "./config";
import type { UserData } from "./user-data";

export interface ServerEvent {
  event_name: string;
  event_time: number;
  event_id?: string;
  event_source_url?: string;
  action_source: "website";
  user_data: UserData;
  custom_data?: Record<string, unknown>;
}

export interface CapiSendResult {
  ok: boolean;
  status?: number;
  eventsReceived?: number;
  fbtraceId?: string;
  errorCode?: number;
  error?: string;
}

interface CapiResponse {
  events_received?: number;
  fbtrace_id?: string;
  messages?: string[];
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

const REQUEST_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 200;

export async function postServerEvents(
  config: CapiConfig,
  events: ServerEvent[],
): Promise<CapiSendResult> {
  if (events.length === 0) return { ok: true, eventsReceived: 0 };

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.pixelId}/events?access_token=${encodeURIComponent(config.accessToken)}`;
  const body: Record<string, unknown> = { data: events };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  const serialized = JSON.stringify(body);

  let lastResult: CapiSendResult = { ok: false, error: "no-attempt" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized,
        signal: controller.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as CapiResponse;

      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          eventsReceived: payload.events_received,
          fbtraceId: payload.fbtrace_id,
        };
      }

      lastResult = {
        ok: false,
        status: res.status,
        errorCode: payload.error?.code,
        fbtraceId: payload.error?.fbtrace_id ?? payload.fbtrace_id,
        error: redact(payload.error?.message ?? `HTTP ${res.status}`, config.accessToken),
      };

      // 4xx other than rate-limit = Meta rejected the payload; retrying won't help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return lastResult;
    } catch (err) {
      lastResult = {
        ok: false,
        error: redact(err instanceof Error ? err.message : "network-error", config.accessToken),
      };
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS + Math.random() * RETRY_BACKOFF_MS);
  }

  return lastResult;
}

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { CapiConfig } from "./config";
import { fetchWithRetry } from "../http/fetch-with-retry";
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

  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: serialized },
      { attempts: MAX_ATTEMPTS, timeoutMs: REQUEST_TIMEOUT_MS, backoffMs: RETRY_BACKOFF_MS },
    );
  } catch (err) {
    return { ok: false, error: redact(err instanceof Error ? err.message : "network-error", config.accessToken) };
  }

  const payload = (await res.json().catch(() => ({}))) as CapiResponse;
  if (res.ok) {
    return {
      ok: true,
      status: res.status,
      eventsReceived: payload.events_received,
      fbtraceId: payload.fbtrace_id,
    };
  }
  return {
    ok: false,
    status: res.status,
    errorCode: payload.error?.code,
    fbtraceId: payload.error?.fbtrace_id ?? payload.fbtrace_id,
    error: redact(payload.error?.message ?? `HTTP ${res.status}`, config.accessToken),
  };
}

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

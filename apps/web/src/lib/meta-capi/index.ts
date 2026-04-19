import { readCapiConfig } from "./config";
import { postServerEvents, type CapiSendResult, type ServerEvent } from "./client";
import { buildUserData, hasMatchableIdentifier, type UserDataInput } from "./user-data";

export interface SendLeadEventInput extends UserDataInput {
  eventId: string;
  eventTime?: number;
  customData?: Record<string, unknown>;
}

const LOG_PREFIX = "[meta-capi]";

// Sends a single server-side Lead event. Contract: never throws. Callers can
// fire-and-forget via `after()` without their own try/catch.
export async function sendLeadEvent(input: SendLeadEventInput): Promise<CapiSendResult> {
  try {
    const config = readCapiConfig();
    if (!config) return { ok: false, error: "capi-disabled" };

    const userData = buildUserData(input);
    if (!hasMatchableIdentifier(userData)) {
      return { ok: false, error: "no-identifiers" };
    }

    const event: ServerEvent = {
      event_name: "Lead",
      event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      event_source_url: input.eventSourceUrl,
      action_source: "website",
      user_data: userData,
      ...(input.customData ? { custom_data: input.customData } : {}),
    };

    const result = await postServerEvents(config, [event]);

    if (!result.ok) {
      console.error(LOG_PREFIX, "lead event failed", {
        status: result.status,
        errorCode: result.errorCode,
        fbtraceId: result.fbtraceId,
        error: result.error,
        eventId: input.eventId,
      });
    } else {
      console.log(LOG_PREFIX, "lead event sent", {
        eventsReceived: result.eventsReceived,
        fbtraceId: result.fbtraceId,
        eventId: input.eventId,
      });
    }

    return result;
  } catch (err) {
    console.error(LOG_PREFIX, "unexpected error", err instanceof Error ? err.message : err);
    return { ok: false, error: "unexpected-error" };
  }
}

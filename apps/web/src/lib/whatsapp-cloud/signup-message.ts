const SIGNUP_TYPE = "WA_EMBEDDED_SIGNUP";
const COEXISTENCE_FINISH_EVENT = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
const META_ID = /^\d{1,64}$/;

// Passed to the popup so the number stays in the owner's WhatsApp Business app.
export const COEXISTENCE_FEATURE_TYPE = "whatsapp_business_app_onboarding";

export type SignupEvent =
  | { kind: "finish"; coexistence: boolean; wabaId: string; phoneNumberId?: string; businessId?: string }
  | { kind: "cancel" }
  | { kind: "no_number" };

// The popup's window message. Only the ids we route on are read, and only when they look like Meta ids.
export function parseSignupMessage(raw: string): SignupEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Other scripts post plain strings to the window too; they are not ours.
    return null;
  }
  if (!isRecord(payload) || payload.type !== SIGNUP_TYPE || typeof payload.event !== "string") return null;
  if (payload.event === "CANCEL") return { kind: "cancel" };
  if (payload.event === "FINISH_ONLY_WABA") return { kind: "no_number" };
  const data = isRecord(payload.data) ? payload.data : {};
  const wabaId = metaId(data.waba_id);
  if (!wabaId) return null;
  const phoneNumberId = metaId(data.phone_number_id);
  const businessId = metaId(data.business_id);
  if (payload.event === "FINISH") {
    return phoneNumberId && businessId ? { kind: "finish", coexistence: false, wabaId, phoneNumberId, businessId } : null;
  }
  if (payload.event === COEXISTENCE_FINISH_EVENT) {
    return {
      kind: "finish",
      coexistence: true,
      wabaId,
      ...(phoneNumberId ? { phoneNumberId } : {}),
      ...(businessId ? { businessId } : {}),
    };
  }
  return null;
}

function metaId(value: unknown): string | null {
  return typeof value === "string" && META_ID.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { BillingErrorCode } from "@/lib/billing/errors";
import type { PlanCode } from "@/lib/billing/pricing";
import type { CheckoutSessionStatus } from "@/lib/billing/domain";
import type { BillingStatus } from "@/lib/billing/service";
import type { MockCheckoutOutcome } from "@/lib/billing/schemas";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

type ApiErrorCode = BillingErrorCode | "invalid_body" | "invalid_json" | "unauthorized" | "internal_error";

const ERROR_MESSAGES_HE: Record<ApiErrorCode, string> = {
  billing_unavailable: "התשלומים עדיין לא פתוחים. נסו שוב מאוחר יותר.",
  invalid_amount: "סכום הטעינה לא תקין.",
  same_plan: "זו כבר התוכנית שלכם.",
  already_subscribed: "כבר יש לכם מנוי פעיל.",
  no_subscription: "לא נמצא מנוי פעיל.",
  unsupported_operation: "הפעולה לא זמינה עבור המנוי הזה.",
  invalid_signature: UNEXPECTED_ERROR_HE,
  invalid_webhook: UNEXPECTED_ERROR_HE,
  provider_error: "ספק התשלומים לא הגיב. נסו שוב בעוד רגע.",
  not_found: "לא נמצא.",
  conflict: "הפעולה כבר בוצעה.",
  rate_limited: "יותר מדי ניסיונות. נסו שוב בעוד שעה.",
  payment_required: "כדי להמשיך צריך מנוי פעיל.",
  checkout_pending: "יש תשלום שעדיין בתהליך. נסו שוב בעוד כמה דקות.",
  invalid_body: UNEXPECTED_ERROR_HE,
  invalid_json: UNEXPECTED_ERROR_HE,
  unauthorized: "צריך להתחבר מחדש.",
  internal_error: UNEXPECTED_ERROR_HE,
};

export class BillingClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BillingClientError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = readErrorCode(body);
    throw new BillingClientError(code, ERROR_MESSAGES_HE[code]);
  }
  return body as T;
}

export function fetchBillingStatus(): Promise<BillingStatus> {
  return call<BillingStatus>("/api/billing/status", { cache: "no-store" });
}

export async function fetchCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
  const { status } = await call<{ status: CheckoutSessionStatus }>(`/api/billing/checkout/${sessionId}`, { cache: "no-store" });
  return status;
}

export async function startCheckout(plan: PlanCode): Promise<string> {
  const { url } = await call<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
  return url;
}

export async function changePlan(plan: PlanCode): Promise<string> {
  const { url } = await call<{ url: string }>("/api/billing/change-plan", { method: "POST", body: JSON.stringify({ plan }) });
  return url;
}

export async function startTopup(amountIls: number): Promise<string> {
  const { url } = await call<{ url: string }>("/api/billing/topup", { method: "POST", body: JSON.stringify({ amountIls }) });
  return url;
}

export function cancelSubscription(): Promise<BillingStatus> {
  return call<BillingStatus>("/api/billing/cancel", { method: "POST" });
}

export function resumeSubscription(): Promise<BillingStatus> {
  return call<BillingStatus>("/api/billing/resume", { method: "POST" });
}

export async function fetchPortalUrl(): Promise<string> {
  const { url } = await call<{ url: string }>("/api/billing/portal", { cache: "no-store" });
  return url;
}

export async function fetchUpdatePaymentMethodUrl(): Promise<string> {
  const { url } = await call<{ url: string }>("/api/billing/payment-method", { cache: "no-store" });
  return url;
}

export async function completeMockCheckout(sessionId: string, outcome: MockCheckoutOutcome): Promise<string> {
  const { redirectTo } = await call<{ redirectTo: string }>("/api/billing/mock/complete", {
    method: "POST",
    body: JSON.stringify({ sessionId, outcome }),
  });
  return redirectTo;
}

function readErrorCode(body: unknown): ApiErrorCode {
  if (typeof body !== "object" || body === null) return "internal_error";
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return "internal_error";
  const code = (error as { code?: unknown }).code;
  return isApiErrorCode(code) ? code : "internal_error";
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MESSAGES_HE, value);
}

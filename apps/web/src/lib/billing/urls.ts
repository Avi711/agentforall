export type CheckoutReturn = "success" | "failed";

export const SETTINGS_PATH = "/app/settings";

export function settingsReturnPath(checkout: CheckoutReturn, sessionId: string): string {
  const params = new URLSearchParams({ checkout, session: sessionId });
  return `${SETTINGS_PATH}?${params.toString()}`;
}

export function isCheckoutReturn(value: unknown): value is CheckoutReturn {
  return value === "success" || value === "failed";
}

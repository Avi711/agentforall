export type CheckoutReturn = "success" | "failed";

export const SETTINGS_PATH = "/app/settings";

export const SETTINGS_SECTION = { plans: "plans", topup: "topup" } as const;
export type SettingsSection = keyof typeof SETTINGS_SECTION;

export function settingsSectionHref(section: SettingsSection): string {
  return `${SETTINGS_PATH}#${SETTINGS_SECTION[section]}`;
}

export function settingsReturnPath(checkout: CheckoutReturn, sessionId: string): string {
  const params = new URLSearchParams({ checkout, session: sessionId });
  return `${SETTINGS_PATH}?${params.toString()}`;
}

export function isCheckoutReturn(value: unknown): value is CheckoutReturn {
  return value === "success" || value === "failed";
}

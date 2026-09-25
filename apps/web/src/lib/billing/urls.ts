export const SETTINGS_PATH = "/app/settings";
export const CHECKOUT_RETURN_PATH = "/app/billing/return";

export const SETTINGS_SECTION = { plans: "plans", topup: "topup" } as const;
export type SettingsSection = keyof typeof SETTINGS_SECTION;

export function settingsSectionHref(section: SettingsSection): string {
  return `${SETTINGS_PATH}#${SETTINGS_SECTION[section]}`;
}

export function checkoutReturnPath(sessionId: string): string {
  return `${CHECKOUT_RETURN_PATH}?${new URLSearchParams({ session: sessionId }).toString()}`;
}

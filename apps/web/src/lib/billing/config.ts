import { BillingUnavailableError } from "./errors";

export type Env = Readonly<Record<string, string | undefined>>;

export interface BillingConfig {
  // False = payments are accepted but never block product access (rollout switch).
  enforcement: boolean;
  appUrl: string;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function readAppUrl(env: Env): string {
  const appUrl = (env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL)?.trim().replace(/\/+$/, "");
  if (!appUrl) throw new BillingUnavailableError("NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL is required");
  return appUrl;
}

export function readBillingConfig(env: Env): BillingConfig {
  return {
    enforcement: TRUE_VALUES.has((env.BILLING_REQUIRED ?? "").trim().toLowerCase()),
    appUrl: readAppUrl(env),
  };
}

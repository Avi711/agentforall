import { BillingUnavailableError } from "../../errors";
import { readAppUrl, type Env } from "../../config";

export interface MockProviderConfig {
  webhookSecret: string;
  appUrl: string;
}

const MIN_SECRET_LENGTH = 16;

export function readMockProviderConfig(env: Env): MockProviderConfig {
  if (env.NODE_ENV === "production") {
    throw new BillingUnavailableError("mock payment provider is not allowed in production");
  }
  const webhookSecret = env.MOCK_PAYMENT_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) throw new BillingUnavailableError("missing env: MOCK_PAYMENT_WEBHOOK_SECRET");
  if (webhookSecret.length < MIN_SECRET_LENGTH) {
    throw new BillingUnavailableError(`MOCK_PAYMENT_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} chars`);
  }
  return { webhookSecret, appUrl: readAppUrl(env) };
}

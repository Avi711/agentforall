import type {
  PAYMENT_PROVIDERS,
  SUBSCRIPTION_STATUSES,
  CHECKOUT_KINDS,
  CHECKOUT_SESSION_STATUSES,
  PAYMENT_STATUSES,
  BILLING_EVENT_STATUSES,
  CREDIT_GRANT_KINDS,
} from "@agent-forall/db";

export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type CheckoutKind = (typeof CHECKOUT_KINDS)[number];
export type CheckoutSessionStatus = (typeof CHECKOUT_SESSION_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type BillingEventStatus = (typeof BILLING_EVENT_STATUSES)[number];
export type CreditGrantKind = (typeof CREDIT_GRANT_KINDS)[number];

// A subscription in one of these states can no longer charge the user.
export const SETTLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ["canceled", "expired", "unpaid"];

export function isSettledStatus(status: SubscriptionStatus): boolean {
  return SETTLED_SUBSCRIPTION_STATUSES.includes(status);
}

// An event still `received` after this long was abandoned mid-flight (function killed) and may be retried.
export const ABANDONED_EVENT_MINUTES = 10;

// Deliveries after which a failing event is acknowledged instead of retried, so a poison message cannot loop.
export const MAX_EVENT_ATTEMPTS = 25;

export interface Subscription {
  id: string;
  userId: string | null;
  provider: PaymentProviderName;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  planCode: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  providerUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckoutSession {
  id: string;
  userId: string;
  provider: PaymentProviderName;
  kind: CheckoutKind;
  productCode: string;
  credits: number;
  amountAgorot: number;
  status: CheckoutSessionStatus;
  providerCheckoutId: string | null;
  createdAt: Date;
  expiresAt: Date;
  settledAt: Date | null;
}

export interface CreditGrant {
  id: string;
  userId: string;
  kind: CreditGrantKind;
  credits: number;
  usedCredits: number;
  sourceRef: string;
  grantedAt: Date;
  expiresAt: Date | null;
}

export interface CreditUsageCursor {
  botId: string;
  userId: string;
  lastSpendUsdCents: number;
  consumedCredits: number;
  unallocatedCredits: number;
  version: number;
  syncedAt: Date;
}

export interface BillingUser {
  id: string;
  email: string;
  name: string | null;
  betaAccess: boolean;
}

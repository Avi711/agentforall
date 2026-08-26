import type {
  BillingEventStatus,
  CheckoutKind,
  CheckoutSession,
  CreditGrant,
  CreditGrantKind,
  CreditUsageCursor,
  PaymentProviderName,
  PaymentStatus,
  Subscription,
  SubscriptionStatus,
} from "./domain";

export interface UpsertSubscriptionInput {
  provider: PaymentProviderName;
  providerSubscriptionId: string;
  // Only fills an empty user_id; an existing link is never overwritten.
  userId: string | null;
  providerCustomerId: string | null;
  planCode: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  providerUpdatedAt: Date;
}

export interface UpsertSubscriptionResult {
  subscription: Subscription;
  // False when the stored row is newer than the input (out-of-order delivery).
  applied: boolean;
}

export interface SubscriptionStatePatch {
  status?: SubscriptionStatus;
  planCode?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
  providerCustomerId?: string | null;
  providerUpdatedAt: Date;
}

export interface SubscriptionRepository {
  findCurrentByUserId(userId: string): Promise<Subscription | null>;
  // Every subscription of the user that may still be charging (not canceled/expired/unpaid).
  listLiveByUserId(userId: string): Promise<Subscription[]>;
  findByProviderRef(provider: PaymentProviderName, providerSubscriptionId: string): Promise<Subscription | null>;
  upsertIfNewer(input: UpsertSubscriptionInput): Promise<UpsertSubscriptionResult>;
  updateState(id: string, patch: SubscriptionStatePatch): Promise<Subscription>;
}

export interface NewCheckoutSession {
  userId: string;
  provider: PaymentProviderName;
  kind: CheckoutKind;
  productCode: string;
  credits: number;
  amountAgorot: number;
  expiresAt: Date;
}

export interface CheckoutSessionRepository {
  create(input: NewCheckoutSession): Promise<CheckoutSession>;
  findById(id: string): Promise<CheckoutSession | null>;
  hasPendingSince(userId: string, since: Date): Promise<boolean>;
  setProviderCheckoutId(id: string, providerCheckoutId: string): Promise<void>;
  // Only a pending session settles; a second outcome for the same session is a no-op.
  settle(id: string, status: "completed" | "failed", at: Date): Promise<void>;
  countOpenedSince(userId: string, since: Date): Promise<number>;
}

export interface NewPayment {
  userId: string | null;
  subscriptionId: string | null;
  provider: PaymentProviderName;
  providerPaymentId: string;
  status: PaymentStatus;
  amountAgorot: number;
  currency: string;
  occurredAt: Date;
}

export type PaymentApplication =
  | { outcome: "applied"; subscription: Subscription }
  // The provider payment id was already recorded (redelivery).
  | { outcome: "duplicate" }
  // Another writer changed the subscription first; re-read and retry.
  | { outcome: "conflict" };

export interface FirstPaymentInput {
  payment: Omit<NewPayment, "subscriptionId">;
  subscription: UpsertSubscriptionInput;
}

export interface RenewalInput {
  payment: Omit<NewPayment, "subscriptionId">;
  subscriptionId: string;
  expectedPeriodEnd: Date | null;
  patch: SubscriptionStatePatch;
}

export interface PaymentRepository {
  // False = this provider payment id was already recorded (redelivery).
  record(input: NewPayment): Promise<boolean>;
  // What this standing order last charged; renewals are validated against it, not today's catalogue.
  lastSucceededAmountAgorot(subscriptionId: string): Promise<number | null>;
  // Payment row + subscription write in one transaction, so a crash can never leave money without state.
  recordFirstPayment(input: FirstPaymentInput): Promise<PaymentApplication>;
  recordRenewal(input: RenewalInput): Promise<PaymentApplication>;
}

export interface NewCreditGrant {
  userId: string;
  kind: CreditGrantKind;
  credits: number;
  sourceRef: string;
  expiresAt: Date | null;
}

export interface CreditGrantRepository {
  listByUserId(userId: string): Promise<CreditGrant[]>;
  // Null = a grant with this sourceRef already exists (idempotent redelivery).
  insertIfAbsent(input: NewCreditGrant): Promise<CreditGrant | null>;
  // Least recently synced first, so a cron that runs out of time never starves the same users twice.
  listUserIdsWithGrants(): Promise<string[]>;
}

// `userId` is null once the claiming account was deleted; the claim itself stands.
export interface TrialClaim {
  userId: string | null;
}

export interface TrialClaimRepository {
  findClaimant(emailHash: string): Promise<TrialClaim | null>;
  // True when claimed now or already held by this same user; false when any other account (even a deleted one) holds it.
  claim(emailHash: string, userId: string): Promise<boolean>;
}

export interface ConsumptionAttribution {
  grantId: string;
  credits: number;
}

export interface AdvanceUsageInput {
  botId: string;
  userId: string;
  expectedVersion: number;
  spendUsdCents: number;
  consumedDelta: number;
  unallocatedDelta: number;
  attributions: ConsumptionAttribution[];
  syncedAt: Date;
}

export interface CreditUsageRepository {
  findByBotId(botId: string): Promise<CreditUsageCursor | null>;
  listByUserId(userId: string): Promise<CreditUsageCursor[]>;
  // Atomic cursor advance + attributions; false (nothing written) when a concurrent sync changed the version or a grant.
  advance(input: AdvanceUsageInput): Promise<boolean>;
}

export interface BotSpend {
  botId: string;
  supported: boolean;
  spendUsdCents: number;
  maxBudgetUsdCents: number | null;
}

// The LLM gateway seen through the orchestrator: read what a bot spent, cap what it may spend.
export interface LlmBudgetPort {
  listLiveBotIds(userId: string): Promise<string[]>;
  readSpend(userId: string, botId: string): Promise<BotSpend>;
  setCeiling(userId: string, botId: string, maxBudgetUsdCents: number): Promise<void>;
}

export interface ClaimBillingEventInput {
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: string;
  providerSubscriptionId: string | null;
  payload: unknown;
}

export type ClaimBillingEventResult =
  | { kind: "new"; id: string }
  // A failed attempt, or one abandoned mid-flight, is handed to exactly one retrying caller.
  | { kind: "retry"; id: string }
  // Also returned for a failed event past MAX_EVENT_ATTEMPTS: acknowledged so the provider stops redelivering.
  | { kind: "duplicate"; status: BillingEventStatus };

export interface FinishBillingEventInput {
  status: Exclude<BillingEventStatus, "received">;
  userId?: string | null;
  note?: string | null;
}

export interface BillingEventRepository {
  claim(input: ClaimBillingEventInput): Promise<ClaimBillingEventResult>;
  finish(id: string, input: FinishBillingEventInput): Promise<void>;
}

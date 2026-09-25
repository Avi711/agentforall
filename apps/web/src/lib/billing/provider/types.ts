import type { PaymentProviderName, SubscriptionStatus } from "../domain";
import type { BillingInterval } from "../pricing";

export interface ProviderCapabilities {
  cancel: boolean;
  resume: boolean;
  customerPortal: boolean;
  updatePaymentMethod: boolean;
  // False when a past-due order can be neither ended nor changed until its charge is paid (Paddle).
  cancelWhilePastDue: boolean;
}

export type CheckoutMode = "subscription" | "one_time";

export interface CreateCheckoutInput {
  checkoutSessionId: string;
  userId: string;
  email: string;
  name: string | null;
  mode: CheckoutMode;
  // How often a subscription charges; null for a one-time charge.
  interval: BillingInterval | null;
  productCode: string;
  // What the buyer gets; each provider names it in its own page's language.
  credits: number;
  amountAgorot: number;
  currency: string;
  successUrl: string;
  failureUrl: string;
  expiresAt: Date;
}

export interface CreateCheckoutResult {
  url: string;
  providerCheckoutId: string | null;
}

// Full state as the provider sees it — only providers that own the subscription lifecycle emit this.
export interface ProviderSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  planCode: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  providerUpdatedAt: Date;
}

export interface ProviderPayment {
  providerPaymentId: string;
  amountAgorot: number;
  currency: string;
}

// The only correlation the service trusts: our own checkout session id, echoed back by the provider.
export interface WebhookReference {
  checkoutSessionId: string | null;
}

export interface EventBase {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
}

export type ProviderEvent =
  | (EventBase & {
      kind: "subscription.snapshot";
      subscription: ProviderSubscription;
      reference: WebhookReference;
    })
  | (EventBase & {
      kind: "payment.succeeded";
      // Null for a one-time charge (top-up).
      providerSubscriptionId: string | null;
      providerCustomerId: string | null;
      planCode: string | null;
      payment: ProviderPayment;
      // Providers that schedule the next charge report it; null = derive from the plan interval.
      periodEnd: Date | null;
      reference: WebhookReference;
    })
  | (EventBase & {
      kind: "payment.failed";
      providerSubscriptionId: string | null;
      payment: ProviderPayment | null;
      reason: string | null;
      reference: WebhookReference;
    })
  | (EventBase & {
      kind: "subscription.canceled";
      providerSubscriptionId: string;
      accessEndsAt: Date | null;
      reference: WebhookReference;
    })
  | (EventBase & {
      kind: "payment.refunded";
      providerPaymentId: string;
      providerSubscriptionId: string | null;
      // A partial refund is left to a human: which credits it covers is a judgement call.
      full: boolean;
      reference: WebhookReference;
    })
  | (EventBase & {
      kind: "checkout.failed";
      reason: string | null;
      reference: WebhookReference;
    })
  | (EventBase & { kind: "ignored" });

export interface WebhookRequest {
  rawBody: string;
  header(name: string): string | null;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  // False = credentials missing; every money operation rejects with BillingUnavailableError.
  readonly available: boolean;
  readonly capabilities: ProviderCapabilities;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  // Establishes authenticity (signature or provider re-query) before returning; never trusts the body alone.
  parseWebhook(request: WebhookRequest): Promise<ProviderEvent>;
  // Null = the provider acknowledged but reports no state; the service derives the new state itself.
  cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;
  resumeSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;
  getCustomerPortalUrl(providerSubscriptionId: string): Promise<string | null>;
  getUpdatePaymentMethodUrl(providerSubscriptionId: string, returnUrl: string): Promise<string | null>;
}

export interface ProviderDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

export type BillingErrorCode =
  | "billing_unavailable"
  | "invalid_amount"
  | "same_plan"
  | "already_subscribed"
  | "no_subscription"
  | "unsupported_operation"
  | "invalid_signature"
  | "invalid_webhook"
  | "provider_error"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payment_required"
  | "checkout_pending";

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly code: BillingErrorCode,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BillingUnavailableError extends BillingError {
  constructor(public readonly reason: string) {
    super(`billing unavailable: ${reason}`, "billing_unavailable", 503, { reason });
  }
}

export class InvalidTopupAmountError extends BillingError {
  constructor(amountIls: number, minIls: number, maxIls: number) {
    super(`top-up must be a whole amount between ${minIls} and ${maxIls} ILS`, "invalid_amount", 400, {
      amountIls,
      minIls,
      maxIls,
    });
  }
}

export class SamePlanError extends BillingError {
  constructor(plan: string) {
    super(`already on plan ${plan}`, "same_plan", 409);
  }
}

export class AlreadySubscribedError extends BillingError {
  constructor() {
    super("user already has an active subscription", "already_subscribed", 409);
  }
}

export class NoSubscriptionError extends BillingError {
  constructor() {
    super("user has no active subscription", "no_subscription", 404);
  }
}

export class UnsupportedBillingOperationError extends BillingError {
  constructor(operation: string, provider: string) {
    super(`${provider} does not support ${operation}`, "unsupported_operation", 400, { operation, provider });
  }
}

export class UnknownProviderError extends BillingError {
  constructor(provider: string) {
    super(`no payment provider named ${provider}`, "not_found", 404);
  }
}

export class CheckoutSessionNotFoundError extends BillingError {
  constructor() {
    super("checkout session not found", "not_found", 404);
  }
}

export class CheckoutAlreadySettledError extends BillingError {
  constructor() {
    super("checkout session already settled", "conflict", 409);
  }
}

// This mailbox already had its trial and nothing else grants access.
export class TrialUnavailableError extends BillingError {
  constructor() {
    super("no trial available and no active subscription", "payment_required", 402);
  }
}

export class PendingCheckoutError extends BillingError {
  constructor() {
    super("a checkout is still pending; wait for it to settle before deleting the account", "checkout_pending", 409);
  }
}

export class TooManyCheckoutsError extends BillingError {
  constructor(limitPerHour: number) {
    super(`more than ${limitPerHour} checkouts opened in the last hour`, "rate_limited", 429);
  }
}

export class WebhookVerificationError extends BillingError {
  constructor(reason: string) {
    super(`webhook rejected: ${reason}`, "invalid_signature", 401);
  }
}

export class MalformedWebhookError extends BillingError {
  constructor(reason: string, details?: unknown) {
    super(`malformed webhook: ${reason}`, "invalid_webhook", 400, details);
  }
}

// Thrown by adapters when the gateway's API misbehaves; `retryable` drives the caller's backoff decision.
export class PaymentProviderError extends BillingError {
  constructor(
    provider: string,
    message: string,
    public readonly providerStatus: number | null,
    public readonly retryable: boolean,
  ) {
    super(`${provider}: ${message}`, "provider_error", 502, { provider, providerStatus });
  }
}

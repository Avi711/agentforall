import { MalformedWebhookError, WebhookVerificationError } from "../../errors";
import { signBody, verifyBodySignature } from "../../provider/hmac";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderPayment,
  ProviderSubscription,
  WebhookRequest,
} from "../../provider/types";
import type { MockProviderConfig } from "./config";
import { MOCK_SIGNATURE_HEADER, MockWebhookSchema, type MockWebhookEvent } from "./wire";

const NO_REFERENCE = { checkoutSessionId: null } as const;

// Local stand-in shaped like an Israeli hosted-page gateway: redirect out, callbacks per charge, no portal.
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly available = true;
  readonly capabilities: ProviderCapabilities = {
    cancel: true,
    resume: true,
    customerPortal: false,
    updatePaymentMethod: false,
  };

  constructor(private readonly config: MockProviderConfig) {}

  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const url = new URL("/app/billing/mock-checkout", this.config.appUrl);
    url.searchParams.set("session", input.checkoutSessionId);
    return Promise.resolve({ url: url.toString(), providerCheckoutId: `mock_chk_${input.checkoutSessionId}` });
  }

  parseWebhook(request: WebhookRequest): Promise<ProviderEvent> {
    if (!verifyBodySignature(this.config.webhookSecret, request.rawBody, request.header(MOCK_SIGNATURE_HEADER))) {
      return Promise.reject(new WebhookVerificationError("bad or missing signature"));
    }
    let json: unknown;
    try {
      json = JSON.parse(request.rawBody);
    } catch {
      return Promise.reject(new MalformedWebhookError("body is not JSON"));
    }
    const parsed = MockWebhookSchema.safeParse(json);
    if (!parsed.success) {
      return Promise.reject(new MalformedWebhookError("unexpected payload shape", parsed.error.flatten().fieldErrors));
    }
    return Promise.resolve(toProviderEvent(parsed.data, json));
  }

  cancelSubscription(_id: string): Promise<ProviderSubscription | null> {
    return Promise.resolve(null);
  }

  resumeSubscription(_id: string): Promise<ProviderSubscription | null> {
    return Promise.resolve(null);
  }

  getCustomerPortalUrl(_id: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  getUpdatePaymentMethodUrl(_id: string, _returnUrl: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // Test/dev tooling: produce a delivery exactly as the mock gateway would send it.
  signedWebhook(event: MockWebhookEvent): WebhookRequest {
    const rawBody = JSON.stringify(event);
    const signature = signBody(this.config.webhookSecret, rawBody);
    return {
      rawBody,
      header: (name) => (name.toLowerCase() === MOCK_SIGNATURE_HEADER ? signature : null),
    };
  }
}

function toProviderEvent(event: MockWebhookEvent, payload: unknown): ProviderEvent {
  const base = {
    providerEventId: event.id,
    eventType: event.type,
    occurredAt: new Date(event.occurredAt),
    payload,
  };
  switch (event.type) {
    case "checkout.completed":
      return {
        ...base,
        kind: "payment.succeeded",
        providerSubscriptionId: event.mode === "subscription" ? event.subscriptionId : null,
        providerCustomerId: event.customerId,
        planCode: event.mode === "subscription" ? event.productCode : null,
        payment: toPayment(event.payment),
        periodEnd: null,
        reference: { checkoutSessionId: event.checkoutSessionId },
      };
    case "checkout.failed":
      return { ...base, kind: "checkout.failed", reason: event.reason, reference: { checkoutSessionId: event.checkoutSessionId } };
    case "payment.succeeded":
      return {
        ...base,
        kind: "payment.succeeded",
        providerSubscriptionId: event.subscriptionId,
        providerCustomerId: null,
        planCode: null,
        payment: toPayment(event.payment),
        periodEnd: null,
        reference: NO_REFERENCE,
      };
    case "payment.failed":
      return {
        ...base,
        kind: "payment.failed",
        providerSubscriptionId: event.subscriptionId,
        payment: event.payment ? toPayment(event.payment) : null,
        reason: event.reason,
        reference: NO_REFERENCE,
      };
    case "subscription.canceled":
      return {
        ...base,
        kind: "subscription.canceled",
        providerSubscriptionId: event.subscriptionId,
        accessEndsAt: event.accessEndsAt ? new Date(event.accessEndsAt) : null,
        reference: NO_REFERENCE,
      };
  }
}

function toPayment(payment: { id: string; amountAgorot: number; currency: string }): ProviderPayment {
  return { providerPaymentId: payment.id, amountAgorot: payment.amountAgorot, currency: payment.currency };
}

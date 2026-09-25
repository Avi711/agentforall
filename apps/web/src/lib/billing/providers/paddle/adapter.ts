import type { z } from "zod";
import { MalformedWebhookError, PaymentOverdueError, PaymentProviderError, WebhookVerificationError } from "../../errors";
import { verifyBodySignature } from "../../provider/hmac";
import { isPlanCode, type PlanCode } from "../../pricing";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  EventBase,
  PaymentProvider,
  ProviderCapabilities,
  ProviderDeps,
  ProviderEvent,
  ProviderSubscription,
  WebhookRequest,
} from "../../provider/types";
import { PaddleApi, type PaddleTransactionItem } from "./client";
import type { PaddleConfig } from "./config";
import {
  PADDLE_SIGNATURE_HEADER,
  PRICE_PLAN_KEY,
  SINGLE_UNIT,
  PaddleAdjustmentSchema,
  PaddleEnvelopeSchema,
  PaddleSubscriptionSchema,
  PaddleTransactionSchema,
  customDataSessionId,
  type PaddleItem,
  type PaddleSubscription,
  type PaddleTransaction,
} from "./wire";

// Outside the signed-in area: Paddle also sends this link (with `_ptxn`) in its own emails.
export const PADDLE_PAY_PATH = "/pay";

// Replays inside the window are absorbed by the event inbox's unique event id.
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

// We create every checkout through the API; a browser-built (`web`) one would carry client-written custom_data.
const CHECKOUT_ORIGIN = "api";
const RENEWAL_ORIGIN = "subscription_recurring";

const SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.trialing",
]);

const ADJUSTMENT_EVENTS: ReadonlySet<string> = new Set(["adjustment.created", "adjustment.updated"]);
// A chargeback warning already takes the disputed amount back.
const MONEY_BACK_ACTIONS: ReadonlySet<string> = new Set(["refund", "chargeback", "chargeback_warning"]);

interface Envelope {
  base: EventBase;
  data: unknown;
}

export class PaddlePaymentProvider implements PaymentProvider {
  readonly name = "paddle" as const;
  readonly available = true;
  readonly capabilities: ProviderCapabilities = {
    cancel: true,
    resume: true,
    customerPortal: true,
    updatePaymentMethod: true,
    cancelWhilePastDue: false,
  };

  private readonly api: PaddleApi;
  private readonly now: () => Date;
  private readonly planByPriceId: ReadonlyMap<string, PlanCode>;

  constructor(
    private readonly config: PaddleConfig,
    deps: ProviderDeps = {},
  ) {
    this.api = new PaddleApi({ environment: config.environment, apiKey: config.apiKey, fetch: deps.fetch });
    this.now = deps.now ?? (() => new Date());
    this.planByPriceId = new Map([...config.priceIds].map(([code, priceId]) => [priceId, code]));
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const transaction = await this.api.createTransaction({
      item: this.itemFor(input),
      currencyCode: input.currency,
      checkoutSessionId: input.checkoutSessionId,
    });
    const url = new URL(PADDLE_PAY_PATH, this.config.appUrl);
    url.searchParams.set("session", input.checkoutSessionId);
    return { url: url.toString(), providerCheckoutId: transaction.id };
  }

  async parseWebhook(request: WebhookRequest): Promise<ProviderEvent> {
    this.verify(request);
    const { base, data } = parseEnvelope(request.rawBody);
    return this.toProviderEvent(base, data) ?? { ...base, kind: "ignored" };
  }

  async cancelSubscription(id: string): Promise<ProviderSubscription> {
    const current = await this.api.getSubscription(id);
    if (current.status === "past_due") throw new PaymentOverdueError();
    return this.fromApi(await this.api.cancelAtPeriodEnd(id));
  }

  async resumeSubscription(id: string): Promise<ProviderSubscription> {
    return this.fromApi(await this.api.removeScheduledChange(id));
  }

  async getCustomerPortalUrl(id: string): Promise<string> {
    const subscription = await this.api.getSubscription(id);
    return this.api.createPortalUrl(subscription.customer_id, id);
  }

  async getUpdatePaymentMethodUrl(id: string, _returnUrl: string): Promise<string | null> {
    const transaction = await this.api.getPaymentMethodUpdateTransaction(id);
    return transaction.checkout?.url ?? null;
  }

  private itemFor(input: CreateCheckoutInput): PaddleTransactionItem {
    if (input.mode === "subscription") return { price_id: this.priceIdFor(input.productCode), quantity: 1 };
    return {
      quantity: 1,
      price: {
        name: `${input.credits.toLocaleString("en-US")} credits`,
        description: input.productCode,
        product_id: this.config.topupProductId,
        unit_price: { amount: String(input.amountAgorot), currency_code: input.currency },
        tax_mode: "internal",
        quantity: SINGLE_UNIT,
      },
    };
  }

  private priceIdFor(productCode: string): string {
    const priceId = isPlanCode(productCode) ? this.config.priceIds.get(productCode) : undefined;
    if (!priceId) throw new Error(`no Paddle price configured for plan ${productCode}`);
    return priceId;
  }

  // The price's own tag first, so subscribers on a retired price keep resolving; the env map covers untagged prices.
  private planOf(items: readonly PaddleItem[]): PlanCode | null {
    const price = items[0]?.price;
    if (!price) return null;
    const tagged = price.custom_data?.[PRICE_PLAN_KEY];
    if (typeof tagged === "string" && isPlanCode(tagged)) return tagged;
    return this.planByPriceId.get(price.id) ?? null;
  }

  // Paddle-Signature: ts=<unix>;h1=<hex>[;h1=<hex>] — several h1 while the secret rotates.
  private verify(request: WebhookRequest): void {
    const header = request.header(PADDLE_SIGNATURE_HEADER);
    if (!header) throw new WebhookVerificationError("missing signature");
    const parts = header.split(";").map((part) => part.split("=", 2));
    const ts = parts.find(([key]) => key === "ts")?.[1];
    const signatures = parts.filter(([key]) => key === "h1").map(([, value]) => value ?? "");
    if (!ts || !/^\d+$/.test(ts) || signatures.length === 0) throw new WebhookVerificationError("malformed signature");
    if (Math.abs(this.now().getTime() - Number(ts) * 1000) > SIGNATURE_TOLERANCE_MS) {
      throw new WebhookVerificationError("signature timestamp outside tolerance");
    }
    const signed = `${ts}:${request.rawBody}`;
    if (!signatures.some((signature) => verifyBodySignature(this.config.webhookSecret, signed, signature))) {
      throw new WebhookVerificationError("bad signature");
    }
  }

  private toProviderEvent(base: EventBase, data: unknown): ProviderEvent | null {
    if (base.eventType === "transaction.completed") return this.toPayment(base, parseData(PaddleTransactionSchema, data));
    if (SUBSCRIPTION_EVENTS.has(base.eventType)) {
      const subscription = parseData(PaddleSubscriptionSchema, data);
      const snapshot = this.toSubscription(subscription);
      if (!snapshot) throw new MalformedWebhookError(`subscription ${subscription.id} is on a price with no plan`);
      return {
        ...base,
        kind: "subscription.snapshot",
        subscription: snapshot,
        reference: { checkoutSessionId: customDataSessionId(subscription.custom_data) },
      };
    }
    if (ADJUSTMENT_EVENTS.has(base.eventType)) {
      const adjustment = parseData(PaddleAdjustmentSchema, data);
      if (!MONEY_BACK_ACTIONS.has(adjustment.action) || adjustment.status !== "approved") return null;
      return {
        ...base,
        kind: "payment.refunded",
        providerPaymentId: adjustment.transaction_id,
        providerSubscriptionId: adjustment.subscription_id ?? null,
        full: adjustment.type === "full",
        reference: { checkoutSessionId: null },
      };
    }
    return null;
  }

  // Only the checkout charge carries our session; renewals copy it from the subscription and resolve through it instead.
  private toPayment(base: EventBase, transaction: PaddleTransaction): ProviderEvent | null {
    const fromCheckout = transaction.origin === CHECKOUT_ORIGIN;
    if (!fromCheckout && transaction.origin !== RENEWAL_ORIGIN) return null;
    const total = transaction.details?.totals.total;
    if (total === undefined) throw new MalformedWebhookError("completed transaction without totals");
    return {
      ...base,
      kind: "payment.succeeded",
      providerSubscriptionId: transaction.subscription_id,
      providerCustomerId: transaction.customer_id,
      planCode: this.planOf(transaction.items),
      payment: { providerPaymentId: transaction.id, amountAgorot: Number(total), currency: transaction.currency_code },
      periodEnd: transaction.billing_period ? new Date(transaction.billing_period.ends_at) : null,
      reference: { checkoutSessionId: fromCheckout ? customDataSessionId(transaction.custom_data) : null },
    };
  }

  // Paddle moves a past-due subscription into the unpaid period, so paid access ends where that period starts.
  private toSubscription(subscription: PaddleSubscription): ProviderSubscription | null {
    const planCode = this.planOf(subscription.items);
    if (!planCode) return null;
    const period = subscription.current_billing_period;
    const paidUntil = period ? (subscription.status === "past_due" ? period.starts_at : period.ends_at) : null;
    return {
      providerSubscriptionId: subscription.id,
      providerCustomerId: subscription.customer_id,
      planCode,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.status === "canceled" || subscription.scheduled_change?.action === "cancel",
      currentPeriodEnd: paidUntil ? new Date(paidUntil) : null,
      trialEndsAt: null,
      providerUpdatedAt: new Date(subscription.updated_at),
    };
  }

  private fromApi(subscription: PaddleSubscription): ProviderSubscription {
    const snapshot = this.toSubscription(subscription);
    if (!snapshot) throw new PaymentProviderError("paddle", `subscription ${subscription.id} is on a price with no plan`, null, false);
    return snapshot;
  }
}

function parseEnvelope(rawBody: string): Envelope {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new MalformedWebhookError("body is not JSON");
  }
  const parsed = PaddleEnvelopeSchema.safeParse(json);
  if (!parsed.success) throw new MalformedWebhookError("unexpected envelope", parsed.error.flatten().fieldErrors);
  return {
    base: {
      providerEventId: parsed.data.event_id,
      eventType: parsed.data.event_type,
      occurredAt: new Date(parsed.data.occurred_at),
      payload: json,
    },
    data: parsed.data.data,
  };
}

function parseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new MalformedWebhookError("unexpected data shape", parsed.error.flatten().fieldErrors);
  return parsed.data;
}

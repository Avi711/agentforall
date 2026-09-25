import type { z } from "zod";
import {
  MalformedWebhookError,
  PaymentDeclinedError,
  PaymentOverdueError,
  PaymentProviderError,
  RenewalImminentError,
  WebhookVerificationError,
  type BillingError,
} from "../../errors";
import { verifyBodySignature } from "../../provider/hmac";
import { isPlanCode, type PlanCode } from "../../pricing";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  EventBase,
  PaymentProvider,
  PlanChangeBilling,
  ProrationLine,
  ProviderCapabilities,
  ProviderDeps,
  ProviderEvent,
  ProviderPlanChangePreview,
  ProviderSubscription,
  WebhookRequest,
} from "../../provider/types";
import { PaddleApi, type PaddleProrationMode, type PaddleTransactionItem } from "./client";
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
  type PaddleLineItem,
  type PaddlePrice,
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
const PLAN_CHANGE_ORIGIN = "subscription_update";

const PRORATION_MODE: Record<PlanChangeBilling, PaddleProrationMode> = {
  prorate_now: "prorated_immediately",
  at_renewal: "do_not_bill",
};

// Paddle refuses a charge under its minimum only in the last hours of a period.
const PLAN_CHANGE_ERRORS: Readonly<Record<string, new () => BillingError>> = {
  subscription_payment_declined: PaymentDeclinedError,
  subscription_update_when_past_due: PaymentOverdueError,
  subscription_locked_renewal: RenewalImminentError,
  subscription_update_transaction_balance_less_than_charge_limit: RenewalImminentError,
};

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
    changePlan: true,
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
    return { url: await this.checkoutUrl(input.checkoutSessionId), providerCheckoutId: transaction.id };
  }

  checkoutUrl(checkoutSessionId: string): Promise<string> {
    const url = new URL(PADDLE_PAY_PATH, this.config.appUrl);
    url.searchParams.set("session", checkoutSessionId);
    return Promise.resolve(url.toString());
  }

  async parseWebhook(request: WebhookRequest): Promise<ProviderEvent> {
    this.verify(request);
    const { base, data } = parseEnvelope(request.rawBody);
    return (await this.toProviderEvent(base, data)) ?? { ...base, kind: "ignored" };
  }

  async cancelSubscription(id: string): Promise<ProviderSubscription> {
    const current = await this.api.getSubscription(id);
    if (current.status === "past_due") throw new PaymentOverdueError();
    return this.fromApi(await this.api.cancelAtPeriodEnd(id));
  }

  async resumeSubscription(id: string): Promise<ProviderSubscription> {
    return this.fromApi(await this.api.removeScheduledChange(id));
  }

  async previewPlanChange(id: string, planCode: string, billing: PlanChangeBilling): Promise<ProviderPlanChangePreview> {
    const preview = await planChangeCall(() => this.api.previewPriceChange(id, this.priceIdFor(planCode), PRORATION_MODE[billing]));
    const immediate = preview.immediate_transaction?.details;
    const lines = immediate ? await this.prorationLines(immediate.line_items, []) : [];
    if (!lines) throw new PaymentProviderError("paddle", `plan change on subscription ${id} prices a plan we do not sell`, null, false);
    return {
      chargeNowAgorot: immediate ? Number(immediate.totals.grand_total) : null,
      creditAgorot: Math.abs(Number(preview.update_summary?.credit.amount ?? 0)),
      lines,
      nextChargeAgorot: preview.next_transaction ? Number(preview.next_transaction.details.totals.total) : null,
      nextChargeAt: preview.next_billed_at ? new Date(preview.next_billed_at) : null,
    };
  }

  async changePlan(id: string, planCode: string, billing: PlanChangeBilling): Promise<ProviderSubscription> {
    return this.fromApi(await planChangeCall(() => this.api.changePrice(id, this.priceIdFor(planCode), PRORATION_MODE[billing])));
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

  private planOf(items: readonly PaddleItem[]): PlanCode | null {
    const priceId = items[0]?.price?.id;
    return priceId ? this.planOfPrice(priceId, items) : null;
  }

  // The price's own tag first, so subscribers on a retired price keep resolving; the env map covers untagged prices.
  private planOfPrice(priceId: string, items: readonly PaddleItem[]): PlanCode | null {
    return planTagOf(items.find((item) => item.price?.id === priceId)?.price) ?? this.planByPriceId.get(priceId) ?? null;
  }

  // A replaced price may be retired and absent from both; Paddle still holds its plan tag.
  private async resolvePlanOfPrice(priceId: string, items: readonly PaddleItem[]): Promise<PlanCode | null> {
    return this.planOfPrice(priceId, items) ?? planTagOf(await this.api.getPrice(priceId));
  }

  // A line without proration is a full new period (an interval change).
  private async prorationLines(lineItems: readonly PaddleLineItem[], items: readonly PaddleItem[]): Promise<ProrationLine[] | null> {
    const lines: ProrationLine[] = [];
    for (const line of lineItems) {
      const planCode = await this.resolvePlanOfPrice(line.price_id, items);
      if (!planCode) return null;
      lines.push({ planCode, quantity: line.quantity, rate: line.proration ? Number(line.proration.rate) : 1 });
    }
    return lines;
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

  private async toProviderEvent(base: EventBase, data: unknown): Promise<ProviderEvent | null> {
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
  private async toPayment(base: EventBase, transaction: PaddleTransaction): Promise<ProviderEvent | null> {
    if (transaction.origin === PLAN_CHANGE_ORIGIN) return this.toProration(base, transaction);
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

  private async toProration(base: EventBase, transaction: PaddleTransaction): Promise<ProviderEvent> {
    const details = transaction.details;
    if (!transaction.subscription_id || !details) throw new MalformedWebhookError("plan change charge without subscription or totals");
    const lines = await this.prorationLines(details.line_items ?? [], transaction.items);
    if (!lines) throw new MalformedWebhookError(`plan change charge ${transaction.id} prices a plan we do not sell`);
    return {
      ...base,
      kind: "subscription.prorated",
      reference: { checkoutSessionId: null },
      providerSubscriptionId: transaction.subscription_id,
      payment: { providerPaymentId: transaction.id, amountAgorot: Number(details.totals.total), currency: transaction.currency_code },
      lines,
      periodEnd: transaction.billing_period ? new Date(transaction.billing_period.ends_at) : null,
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

function planTagOf(price: PaddlePrice | null | undefined): PlanCode | null {
  const tag = price?.custom_data?.[PRICE_PLAN_KEY];
  return typeof tag === "string" && isPlanCode(tag) ? tag : null;
}

async function planChangeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const Known = err instanceof PaymentProviderError && err.providerCode ? PLAN_CHANGE_ERRORS[err.providerCode] : undefined;
    throw Known ? new Known() : err;
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

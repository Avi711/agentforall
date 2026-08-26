import type { CreditService, CreditSummary, SyncAllResult, TrialState } from "./credits/service";
import { trialClaimKey } from "./credits/trial-claim";
import { HOUR_MS, addInterval, laterOf } from "./dates";
import {
  isSettledStatus,
  type BillingUser,
  type CheckoutKind,
  type CheckoutSession,
  type PaymentProviderName,
  type Subscription,
  type SubscriptionStatus,
} from "./domain";
import {
  ACTIVE_GRACE_MS,
  computeEntitlement,
  evaluateSubscription,
  isPaidReason,
  type EntitlementReason,
} from "./entitlement";
import {
  AlreadySubscribedError,
  InvalidTopupAmountError,
  NoSubscriptionError,
  PendingCheckoutError,
  SamePlanError,
  TooManyCheckoutsError,
  TrialUnavailableError,
  UnknownProviderError,
  UnsupportedBillingOperationError,
} from "./errors";
import { consoleBillingLogger, errorMessage, type BillingLogger } from "./logger";
import type {
  BillingEventRepository,
  CheckoutSessionRepository,
  NewPayment,
  PaymentApplication,
  PaymentRepository,
  SubscriptionRepository,
  TrialClaimRepository,
  UpsertSubscriptionInput,
} from "./ports";
import {
  MAX_OPEN_CHECKOUTS_PER_HOUR,
  PLANS,
  PLAN_CATALOGUE,
  TOPUP_MAX_ILS,
  TOPUP_MIN_ILS,
  TOPUP_TERMS,
  agorotFromIls,
  creditsForTopupIls,
  findPlan,
  isValidTopupAmountIls,
  planAmountAgorot,
  resolvePlan,
  type Plan,
  type PlanCode,
  type TopupTerms,
} from "./pricing";
import type { ProviderRegistry } from "./provider/registry";
import type {
  PaymentProvider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderPayment,
  ProviderSubscription,
  WebhookRequest,
} from "./provider/types";
import { SETTINGS_PATH, settingsReturnPath, type CheckoutReturn } from "./urls";

const CHECKOUT_TTL_MS = HOUR_MS;
const RENEWAL_ATTEMPTS = 3;

export interface SubscriptionView {
  provider: PaymentProviderName;
  planCode: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

export interface BillingStatus {
  // Null while no provider is configured.
  provider: PaymentProviderName | null;
  available: boolean;
  enforcement: boolean;
  entitled: boolean;
  reason: EntitlementReason;
  // True when access comes from a paid subscription rather than trial/beta/enforcement-off.
  paid: boolean;
  plan: Plan;
  plans: readonly Plan[];
  subscription: SubscriptionView | null;
  capabilities: ProviderCapabilities;
  credits: CreditSummary;
  topup: TopupTerms;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

// Recorded on the event row; a `failed` note makes the provider redeliver until it resolves.
export type ProcessingNote =
  | "stale_event"
  | "duplicate_payment"
  | "already_settled"
  | "topup_failed"
  | "unknown_subscription"
  | "missing_subscription"
  | "unresolved_user"
  | "unknown_plan"
  | "amount_mismatch"
  | "topup_with_subscription";

export interface BillingServiceDeps {
  providers: ProviderRegistry;
  subscriptions: SubscriptionRepository;
  checkouts: CheckoutSessionRepository;
  payments: PaymentRepository;
  events: BillingEventRepository;
  trialClaims: TrialClaimRepository;
  credits: CreditService;
  enforcement: boolean;
  appUrl: string;
  now?: () => Date;
  logger?: BillingLogger;
}

interface CheckoutProduct {
  kind: CheckoutKind;
  productCode: string;
  description: string;
  credits: number;
  amountAgorot: number;
}

type PaymentSucceeded = Extract<ProviderEvent, { kind: "payment.succeeded" }>;
type PaymentFailed = Extract<ProviderEvent, { kind: "payment.failed" }>;
type SubscriptionCanceled = Extract<ProviderEvent, { kind: "subscription.canceled" }>;
type SubscriptionSnapshot = Extract<ProviderEvent, { kind: "subscription.snapshot" }>;

interface Applied {
  userId: string | null;
  note: ProcessingNote | null;
}

// Aborts processing after any ledger writes so far; the event is stored `failed` and the provider retries.
class EventProcessingError extends Error {
  constructor(
    readonly note: ProcessingNote,
    readonly userId: string | null,
  ) {
    super(note);
    this.name = "EventProcessingError";
  }
}

export class BillingService {
  private readonly providers: ProviderRegistry;
  private readonly subscriptions: SubscriptionRepository;
  private readonly checkouts: CheckoutSessionRepository;
  private readonly payments: PaymentRepository;
  private readonly events: BillingEventRepository;
  private readonly trialClaims: TrialClaimRepository;
  private readonly credits: CreditService;
  private readonly enforcement: boolean;
  private readonly appUrl: string;
  private readonly now: () => Date;
  private readonly log: BillingLogger;

  constructor(deps: BillingServiceDeps) {
    this.providers = deps.providers;
    this.subscriptions = deps.subscriptions;
    this.checkouts = deps.checkouts;
    this.payments = deps.payments;
    this.events = deps.events;
    this.trialClaims = deps.trialClaims;
    this.credits = deps.credits;
    this.enforcement = deps.enforcement;
    this.appUrl = deps.appUrl;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.logger ?? consoleBillingLogger;
  }

  get activeProvider(): PaymentProvider {
    return this.providers.active;
  }

  // Ledger-only; safe for polling.
  async getStatus(user: BillingUser): Promise<BillingStatus> {
    const [subscription, credits] = await Promise.all([
      this.subscriptions.findCurrentByUserId(user.id),
      this.credits.summary(user.id),
    ]);
    return this.buildStatus(user, subscription, credits);
  }

  // Pulls spend from the gateway and re-caps bots; falls back to the ledger when the gateway is unreachable.
  async refreshStatus(user: BillingUser): Promise<BillingStatus> {
    const [subscription, credits] = await Promise.all([
      this.subscriptions.findCurrentByUserId(user.id),
      this.credits.sync(user.id).catch(async (err: unknown) => {
        this.log.error("credit refresh failed; serving ledger state", { userId: user.id, error: errorMessage(err) });
        return { ...(await this.credits.summary(user.id)), stale: true };
      }),
    ]);
    return this.buildStatus(user, subscription, credits);
  }

  async isEntitled(user: BillingUser): Promise<boolean> {
    const [subscription, trial] = await Promise.all([
      this.subscriptions.findCurrentByUserId(user.id),
      this.credits.trialState(user.id).then((state) => this.honourTrialClaim(user, state)),
    ]);
    return this.entitlementOf(user, subscription, trial).entitled;
  }

  // The trial lands before the container exists. Anyone entitled without one (paid, beta, enforcement off) gets
  // no grant and stays on the gateway's default budget; nobody is ever capped to zero while still entitled.
  async beforeBotCreate(user: BillingUser): Promise<void> {
    const [subscription, trial] = await Promise.all([
      this.subscriptions.findCurrentByUserId(user.id),
      this.credits.trialState(user.id).then((state) => this.honourTrialClaim(user, state)),
    ]);
    if (trial.kind === "active" || this.entitlementOf(user, subscription, { kind: "used" }).entitled) return;
    if (trial.kind !== "available") throw new TrialUnavailableError();
    if (!(await this.trialClaims.claim(trialClaimKey(user.email), user.id))) throw new TrialUnavailableError();
    await this.credits.startTrial(user.id);
  }

  afterBotCreated(userId: string): Promise<CreditSummary> {
    return this.credits.sync(userId);
  }

  // Fail-closed: a bot whose spend cannot be read is not deleted, or that spend would never be charged.
  beforeBotDelete(userId: string, botId: string): Promise<void> {
    return this.credits.settleBot(userId, botId);
  }

  syncAllCredits(): Promise<SyncAllResult> {
    return this.credits.syncAll();
  }

  async findCheckoutSession(user: BillingUser, id: string): Promise<CheckoutSession | null> {
    const session = await this.checkouts.findById(id);
    return session && session.userId === user.id ? session : null;
  }

  // A subscription that is already ending may be replaced; only a live, continuing one blocks a new checkout.
  async startCheckout(user: BillingUser, planCode: PlanCode): Promise<{ url: string }> {
    const current = await this.subscriptions.findCurrentByUserId(user.id);
    if (current && isContinuing(current, this.now())) throw new AlreadySubscribedError();
    return this.openCheckout(user, subscriptionProduct(PLANS[planCode]));
  }

  // Israeli standing orders cannot be re-priced: the current one ends at its period end and a new one starts now.
  async changePlan(user: BillingUser, planCode: PlanCode): Promise<{ url: string }> {
    const current = await this.requireEntitledSubscription(user.id);
    if (current.cancelAtPeriodEnd) return this.openCheckout(user, subscriptionProduct(PLANS[planCode]));
    if (current.planCode === planCode) throw new SamePlanError(planCode);

    await this.assertCheckoutAllowed(user.id, this.now());
    const provider = this.providerFor(current, "cancel");
    await this.cancelAtProvider(current, provider);
    this.log.info("subscription cancelled for plan change", { userId: user.id, from: current.planCode, to: planCode });
    try {
      return await this.openCheckout(user, subscriptionProduct(PLANS[planCode]));
    } catch (err) {
      await this.tryResume(current, provider);
      throw err;
    }
  }

  // Top-ups require a paid relationship; trial users are pointed at the subscription instead.
  async startTopup(user: BillingUser, amountIls: number): Promise<{ url: string }> {
    if (!isValidTopupAmountIls(amountIls)) throw new InvalidTopupAmountError(amountIls, TOPUP_MIN_ILS, TOPUP_MAX_ILS);
    await this.requireEntitledSubscription(user.id);
    const credits = creditsForTopupIls(amountIls);
    return this.openCheckout(user, {
      kind: "topup",
      productCode: `topup_ils_${amountIls}`,
      description: `${credits} קרדיטים`,
      credits,
      amountAgorot: agorotFromIls(amountIls),
    });
  }

  // Ends every standing order the user still has, not only the newest one.
  async cancel(user: BillingUser): Promise<BillingStatus> {
    const current = await this.requireEntitledSubscription(user.id);
    let latest = current;
    for (const subscription of await this.subscriptions.listLiveByUserId(user.id)) {
      if (subscription.cancelAtPeriodEnd) continue;
      const provider = this.providerFor(subscription, "cancel");
      const cancelled = await this.cancelAtProvider(subscription, provider);
      if (subscription.id === current.id) latest = cancelled;
      this.log.info("subscription cancel requested", { userId: user.id, provider: provider.name });
    }
    return this.statusFor(user, latest);
  }

  async resume(user: BillingUser): Promise<BillingStatus> {
    const current = await this.requireEntitledSubscription(user.id);
    if (!current.cancelAtPeriodEnd) return this.statusFor(user, current);
    const provider = this.providerFor(current, "resume");
    const subscription = await this.applyResumption(current, await provider.resumeSubscription(current.providerSubscriptionId));
    this.log.info("subscription resumed", { userId: user.id, provider: provider.name });
    return this.statusFor(user, subscription);
  }

  async getCustomerPortalUrl(user: BillingUser): Promise<string> {
    const current = await this.requireSubscription(user.id);
    const provider = this.providerFor(current, "customerPortal");
    const url = await provider.getCustomerPortalUrl(current.providerSubscriptionId);
    if (!url) throw new UnsupportedBillingOperationError("customerPortal", provider.name);
    return url;
  }

  async getUpdatePaymentMethodUrl(user: BillingUser): Promise<string> {
    const current = await this.requireSubscription(user.id);
    const provider = this.providerFor(current, "updatePaymentMethod");
    const url = await provider.getUpdatePaymentMethodUrl(current.providerSubscriptionId, `${this.appUrl}${SETTINGS_PATH}`);
    if (!url) throw new UnsupportedBillingOperationError("updatePaymentMethod", provider.name);
    return url;
  }

  // A provider error aborts the deletion; an unconfigured provider is cancelled locally so erasure never blocks on config.
  async cancelForAccountDeletion(userId: string): Promise<void> {
    const now = this.now();
    if (await this.checkouts.hasPendingSince(userId, new Date(now.getTime() - CHECKOUT_TTL_MS))) {
      throw new PendingCheckoutError();
    }
    for (const subscription of await this.subscriptions.listLiveByUserId(userId)) {
      if (subscription.cancelAtPeriodEnd) continue;
      const provider = this.providers.byName(subscription.provider);
      if (!provider || !provider.capabilities.cancel) {
        this.log.error("cancelling locally: provider cannot cancel", { userId, provider: subscription.provider });
        await this.applyCancellation(subscription, null);
        continue;
      }
      await this.cancelAtProvider(subscription, provider);
      this.log.info("subscription cancelled for account deletion", { userId, provider: provider.name });
    }
  }

  async handleWebhook(providerName: string, request: WebhookRequest): Promise<WebhookOutcome> {
    const provider = this.providers.byName(providerName);
    if (!provider) throw new UnknownProviderError(providerName);

    const event = await provider.parseWebhook(request);
    const claim = await this.events.claim({
      provider: provider.name,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      providerSubscriptionId: subscriptionIdOf(event),
      payload: event.payload,
    });
    if (claim.kind === "duplicate") {
      this.log.info("webhook duplicate", { provider: provider.name, eventType: event.eventType, status: claim.status });
      return "duplicate";
    }

    try {
      const outcome = await this.applyEvent(provider.name, event, claim.id);
      this.log.info("webhook applied", { provider: provider.name, eventType: event.eventType, outcome });
      return outcome;
    } catch (err) {
      const note = err instanceof EventProcessingError ? err.note : errorMessage(err);
      const userId = err instanceof EventProcessingError ? err.userId : undefined;
      await this.events.finish(claim.id, { status: "failed", note, userId }).catch((finishErr: unknown) => {
        this.log.error("could not mark event failed", { eventId: claim.id, error: errorMessage(finishErr) });
      });
      this.log.error("webhook processing failed", { provider: provider.name, eventType: event.eventType, note });
      throw err;
    }
  }

  private async openCheckout(user: BillingUser, product: CheckoutProduct): Promise<{ url: string }> {
    const provider = this.providers.active;
    const now = this.now();
    await this.assertCheckoutAllowed(user.id, now);

    const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);
    const session = await this.checkouts.create({
      userId: user.id,
      provider: provider.name,
      kind: product.kind,
      productCode: product.productCode,
      credits: product.credits,
      amountAgorot: product.amountAgorot,
      expiresAt,
    });
    const result = await provider.createCheckout({
      checkoutSessionId: session.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      mode: product.kind === "subscription" ? "subscription" : "one_time",
      productCode: product.productCode,
      description: product.description,
      amountAgorot: product.amountAgorot,
      currency: "ILS",
      successUrl: this.returnUrl("success", session.id),
      failureUrl: this.returnUrl("failed", session.id),
      expiresAt,
    });
    if (result.providerCheckoutId) {
      await this.checkouts.setProviderCheckoutId(session.id, result.providerCheckoutId);
    }
    this.log.info("checkout started", {
      userId: user.id,
      provider: provider.name,
      kind: product.kind,
      product: product.productCode,
      sessionId: session.id,
    });
    return { url: result.url };
  }

  private async applyEvent(provider: PaymentProviderName, event: ProviderEvent, eventId: string): Promise<WebhookOutcome> {
    if (event.kind === "ignored") {
      await this.events.finish(eventId, { status: "ignored" });
      return "ignored";
    }
    const session = await this.findReferencedSession(provider, event.reference.checkoutSessionId);
    const applied = await this.applyCorrelatedEvent(provider, event, session);
    await this.events.finish(eventId, { status: "processed", userId: applied.userId, note: applied.note });
    return "processed";
  }

  private applyCorrelatedEvent(
    provider: PaymentProviderName,
    event: Exclude<ProviderEvent, { kind: "ignored" }>,
    session: CheckoutSession | null,
  ): Promise<Applied> {
    switch (event.kind) {
      case "checkout.failed":
        return this.applyCheckoutFailed(event.occurredAt, session, null);
      case "payment.succeeded":
        return session?.kind === "topup"
          ? this.applyTopup(provider, event, session)
          : this.applySubscriptionPayment(provider, event, session);
      case "payment.failed":
        return session?.kind === "topup"
          ? this.applyCheckoutFailed(event.occurredAt, session, "topup_failed")
          : this.applyPaymentFailed(provider, event);
      case "subscription.canceled":
        return this.applyCanceled(provider, event);
      case "subscription.snapshot":
        return this.applySnapshot(provider, event, session);
    }
  }

  private async applyCheckoutFailed(at: Date, session: CheckoutSession | null, note: ProcessingNote | null): Promise<Applied> {
    if (session) await this.checkouts.settle(session.id, "failed", at);
    return { userId: session?.userId ?? null, note };
  }

  // Failure paths write nothing: a payment row recorded now would block the period extension on redelivery.
  private async applyTopup(provider: PaymentProviderName, event: PaymentSucceeded, session: CheckoutSession): Promise<Applied> {
    if (event.providerSubscriptionId !== null) throw new EventProcessingError("topup_with_subscription", session.userId);
    if (!coversSession(event.payment, session)) throw new EventProcessingError("amount_mismatch", session.userId);
    const recorded = await this.payments.record(
      toNewPayment(provider, event.payment, "succeeded", event.occurredAt, session.userId, null),
    );
    await this.checkouts.settle(session.id, "completed", event.occurredAt);
    await this.credits.grantTopup(session.userId, session.credits, `topup:${provider}:${event.payment.providerPaymentId}`);
    await this.recapAfterLedgerWrite(session.userId);
    return { userId: session.userId, note: recorded ? null : "duplicate_payment" };
  }

  private async applySubscriptionPayment(
    provider: PaymentProviderName,
    event: PaymentSucceeded,
    session: CheckoutSession | null,
  ): Promise<Applied> {
    const providerSubscriptionId = event.providerSubscriptionId;
    if (providerSubscriptionId === null) throw new EventProcessingError("missing_subscription", null);

    const existing = await this.subscriptions.findByProviderRef(provider, providerSubscriptionId);
    const userId = session?.userId ?? existing?.userId ?? null;
    if (!userId) throw new EventProcessingError("unresolved_user", null);
    const plan = findPlan(planCodeFor(event, session, existing));
    if (!plan) throw new EventProcessingError("unknown_plan", userId);
    const covered = session
      ? coversSession(event.payment, session)
      : coversPlan(event.payment, plan, existing ? await this.payments.lastSucceededAmountAgorot(existing.id) : null);
    if (!covered) throw new EventProcessingError("amount_mismatch", userId);

    const application = existing
      ? await this.renew(provider, event, existing, plan, userId)
      : await this.startSubscription(provider, event, providerSubscriptionId, plan, userId);
    const subscription = application.outcome === "applied" ? application.subscription : existing;
    if (!subscription) throw new Error("duplicate first payment without a stored subscription");
    if (session) await this.checkouts.settle(session.id, "completed", event.occurredAt);
    await this.credits.grantPlanCredits(
      userId,
      plan.includedCredits,
      new Date((subscription.currentPeriodEnd ?? event.occurredAt).getTime() + ACTIVE_GRACE_MS),
      `plan:${provider}:${event.payment.providerPaymentId}`,
    );
    await this.recapAfterLedgerWrite(userId);
    return { userId, note: application.outcome === "duplicate" ? "duplicate_payment" : null };
  }

  private async startSubscription(
    provider: PaymentProviderName,
    event: PaymentSucceeded,
    providerSubscriptionId: string,
    plan: Plan,
    userId: string,
  ): Promise<PaymentApplication> {
    const application = await this.payments.recordFirstPayment({
      payment: toNewPayment(provider, event.payment, "succeeded", event.occurredAt, userId, null),
      subscription: {
        provider,
        providerSubscriptionId,
        userId,
        providerCustomerId: event.providerCustomerId,
        planCode: plan.code,
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: event.periodEnd ?? addInterval(event.occurredAt, plan.interval),
        trialEndsAt: null,
        providerUpdatedAt: event.occurredAt,
      },
    });
    if (application.outcome === "conflict") throw new Error("first payment reported a conflict");
    if (application.outcome === "applied") await this.endOtherStandingOrders(userId, application.subscription);
    return application;
  }

  // A lapsed order that later charges again would otherwise bill the user twice a month.
  private async endOtherStandingOrders(userId: string, kept: Subscription): Promise<void> {
    for (const other of await this.subscriptions.listLiveByUserId(userId)) {
      if (other.id === kept.id || other.cancelAtPeriodEnd) continue;
      const provider = this.providers.byName(other.provider);
      try {
        if (provider?.capabilities.cancel) await this.cancelAtProvider(other, provider);
        else await this.applyCancellation(other, null);
        this.log.warn("ended a second standing order", { userId, kept: kept.id, ended: other.id });
      } catch (err) {
        this.log.error("could not end a second standing order", { userId, ended: other.id, error: errorMessage(err) });
      }
    }
  }

  // State follows the money, except that a charge older than the stored state extends the period without reviving it.
  private async renew(
    provider: PaymentProviderName,
    event: PaymentSucceeded,
    existing: Subscription,
    plan: Plan,
    userId: string,
  ): Promise<PaymentApplication> {
    let current = existing;
    for (let attempt = 1; attempt <= RENEWAL_ATTEMPTS; attempt++) {
      const currentPeriodEnd = nextPeriodEnd(current, event.periodEnd, event.occurredAt, plan);
      const application = await this.payments.recordRenewal({
        payment: toNewPayment(provider, event.payment, "succeeded", event.occurredAt, userId, current.id),
        subscriptionId: current.id,
        expectedPeriodEnd: current.currentPeriodEnd,
        patch: isStale(event.occurredAt, current)
          ? { currentPeriodEnd, providerUpdatedAt: current.providerUpdatedAt }
          : {
              status: "active",
              planCode: plan.code,
              cancelAtPeriodEnd: false,
              currentPeriodEnd,
              providerCustomerId: event.providerCustomerId ?? current.providerCustomerId,
              providerUpdatedAt: event.occurredAt,
            },
      });
      if (application.outcome !== "conflict") return application;
      const reread = await this.subscriptions.findByProviderRef(provider, current.providerSubscriptionId);
      if (!reread) throw new Error(`subscription ${current.id} vanished during renewal`);
      current = reread;
    }
    throw new Error(`renewal of ${existing.id} conflicted ${RENEWAL_ATTEMPTS} times`);
  }

  private async applyPaymentFailed(provider: PaymentProviderName, event: PaymentFailed): Promise<Applied> {
    if (event.providerSubscriptionId === null) throw new EventProcessingError("missing_subscription", null);
    const existing = await this.subscriptions.findByProviderRef(provider, event.providerSubscriptionId);
    if (!existing) throw new EventProcessingError("unknown_subscription", null);
    if (event.payment) {
      await this.payments.record(toNewPayment(provider, event.payment, "failed", event.occurredAt, existing.userId, existing.id));
    }
    if (isStale(event.occurredAt, existing)) return { userId: existing.userId, note: "stale_event" };
    if (isSettledStatus(existing.status)) return { userId: existing.userId, note: "already_settled" };
    await this.subscriptions.updateState(existing.id, { status: "past_due", providerUpdatedAt: event.occurredAt });
    return { userId: existing.userId, note: null };
  }

  private async applyCanceled(provider: PaymentProviderName, event: SubscriptionCanceled): Promise<Applied> {
    const existing = await this.subscriptions.findByProviderRef(provider, event.providerSubscriptionId);
    if (!existing) throw new EventProcessingError("unknown_subscription", null);
    if (isStale(event.occurredAt, existing)) return { userId: existing.userId, note: "stale_event" };
    await this.subscriptions.updateState(existing.id, {
      status: "canceled",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: event.accessEndsAt ?? existing.currentPeriodEnd,
      providerUpdatedAt: event.occurredAt,
    });
    return { userId: existing.userId, note: null };
  }

  private async applySnapshot(
    provider: PaymentProviderName,
    event: SubscriptionSnapshot,
    session: CheckoutSession | null,
  ): Promise<Applied> {
    const existing = await this.subscriptions.findByProviderRef(provider, event.subscription.providerSubscriptionId);
    const userId = session?.userId ?? existing?.userId ?? null;
    if (!userId) throw new EventProcessingError("unresolved_user", null);
    const result = await this.subscriptions.upsertIfNewer(toUpsert(provider, event.subscription, userId));
    if (session) await this.checkouts.settle(session.id, "completed", event.occurredAt);
    return { userId, note: result.applied ? null : "stale_event" };
  }

  // The ledger is durable at this point; a gateway hiccup must not make the provider redeliver money.
  private async recapAfterLedgerWrite(userId: string): Promise<void> {
    try {
      await this.credits.sync(userId);
    } catch (err) {
      this.log.error("re-cap after payment failed; cron will repair", { userId, error: errorMessage(err) });
    }
  }

  private async cancelAtProvider(subscription: Subscription, provider: PaymentProvider): Promise<Subscription> {
    const snapshot = await provider.cancelSubscription(subscription.providerSubscriptionId);
    return this.applyCancellation(subscription, snapshot);
  }

  // Best-effort undo when the step after a cancellation fails; the user can always resume by hand.
  private async tryResume(subscription: Subscription, provider: PaymentProvider): Promise<void> {
    if (!provider.capabilities.resume) return;
    try {
      await this.applyResumption(subscription, await provider.resumeSubscription(subscription.providerSubscriptionId));
    } catch (err) {
      this.log.error("could not resume after a failed plan change", { subscriptionId: subscription.id, error: errorMessage(err) });
    }
  }

  private async applyResumption(current: Subscription, snapshot: ProviderSubscription | null): Promise<Subscription> {
    if (snapshot) {
      return (await this.subscriptions.upsertIfNewer(toUpsert(current.provider, snapshot, current.userId))).subscription;
    }
    return this.subscriptions.updateState(current.id, {
      status: "active",
      cancelAtPeriodEnd: false,
      providerUpdatedAt: this.now(),
    });
  }

  private async assertCheckoutAllowed(userId: string, now: Date): Promise<void> {
    const opened = await this.checkouts.countOpenedSince(userId, new Date(now.getTime() - HOUR_MS));
    if (opened >= MAX_OPEN_CHECKOUTS_PER_HOUR) throw new TooManyCheckoutsError(MAX_OPEN_CHECKOUTS_PER_HOUR);
  }

  private async applyCancellation(current: Subscription, snapshot: ProviderSubscription | null): Promise<Subscription> {
    if (snapshot) {
      return (await this.subscriptions.upsertIfNewer(toUpsert(current.provider, snapshot, current.userId))).subscription;
    }
    return this.subscriptions.updateState(current.id, {
      status: "canceled",
      cancelAtPeriodEnd: true,
      providerUpdatedAt: this.now(),
    });
  }

  private async findReferencedSession(provider: PaymentProviderName, sessionId: string | null): Promise<CheckoutSession | null> {
    if (!sessionId) return null;
    const session = await this.checkouts.findById(sessionId);
    if (session && session.provider !== provider) {
      this.log.warn("callback referenced another provider's session", { provider, sessionId, sessionProvider: session.provider });
      return null;
    }
    return session;
  }

  private async requireSubscription(userId: string): Promise<Subscription> {
    const current = await this.subscriptions.findCurrentByUserId(userId);
    if (!current) throw new NoSubscriptionError();
    return current;
  }

  private async requireEntitledSubscription(userId: string): Promise<Subscription> {
    const current = await this.requireSubscription(userId);
    if (!evaluateSubscription(current, this.now()).entitled) throw new NoSubscriptionError();
    return current;
  }

  private providerFor(subscription: Subscription, operation: keyof ProviderCapabilities): PaymentProvider {
    const provider = this.providers.byName(subscription.provider);
    if (!provider) throw new UnsupportedBillingOperationError(operation, subscription.provider);
    if (!provider.capabilities[operation]) throw new UnsupportedBillingOperationError(operation, provider.name);
    return provider;
  }

  private async statusFor(user: BillingUser, subscription: Subscription): Promise<BillingStatus> {
    return this.buildStatus(user, subscription, await this.credits.summary(user.id));
  }

  private async buildStatus(user: BillingUser, subscription: Subscription | null, summary: CreditSummary): Promise<BillingStatus> {
    const active = this.providers.active;
    const trial = await this.honourTrialClaim(user, summary.trial);
    const entitlement = this.entitlementOf(user, subscription, trial);
    const owner = subscription ? this.providers.byName(subscription.provider) : null;
    const credits = trial === summary.trial ? summary : { ...summary, trial };
    return {
      provider: active.available ? active.name : null,
      available: active.available,
      enforcement: this.enforcement,
      entitled: entitlement.entitled,
      reason: entitlement.reason,
      paid: isPaidReason(entitlement.reason),
      plan: resolvePlan(subscription?.planCode ?? null),
      plans: PLAN_CATALOGUE,
      subscription: subscription ? toSubscriptionView(subscription) : null,
      capabilities: (owner ?? active).capabilities,
      credits,
      topup: TOPUP_TERMS,
    };
  }

  // "No grants yet" only means a trial if this mailbox never claimed one under another (possibly deleted) account.
  private async honourTrialClaim(user: BillingUser, trial: TrialState): Promise<TrialState> {
    if (trial.kind !== "available") return trial;
    const claim = await this.trialClaims.findClaimant(trialClaimKey(user.email));
    return claim === null || claim.userId === user.id ? trial : { kind: "used" };
  }

  private entitlementOf(user: BillingUser, subscription: Subscription | null, trial: TrialState) {
    return computeEntitlement({ subscription, trial, betaAccess: user.betaAccess, enforcement: this.enforcement, now: this.now() });
  }

  private returnUrl(checkout: CheckoutReturn, sessionId: string): string {
    return `${this.appUrl}${settingsReturnPath(checkout, sessionId)}`;
  }
}

function subscriptionProduct(plan: Plan): CheckoutProduct {
  return {
    kind: "subscription",
    productCode: plan.code,
    description: plan.name,
    credits: plan.includedCredits,
    amountAgorot: planAmountAgorot(plan),
  };
}

function isContinuing(subscription: Subscription, now: Date): boolean {
  return (
    evaluateSubscription(subscription, now).entitled && !subscription.cancelAtPeriodEnd && subscription.status !== "canceled"
  );
}

function isStale(occurredAt: Date, existing: Subscription): boolean {
  return occurredAt.getTime() < existing.providerUpdatedAt.getTime();
}

function coversSession(payment: ProviderPayment, session: CheckoutSession): boolean {
  return payment.currency === "ILS" && payment.amountAgorot >= session.amountAgorot;
}

// A renewal has no session to compare against: what the order last charged is the floor (a standing order keeps
// its signup price through catalogue changes); the catalogue price only for an order that never paid.
function coversPlan(payment: ProviderPayment, plan: Plan, lastPaidAgorot: number | null): boolean {
  return payment.currency === plan.currency && payment.amountAgorot >= (lastPaidAgorot ?? planAmountAgorot(plan));
}

// A checkout session names the plan the user just chose; without one, the stored plan wins over the provider's hint.
function planCodeFor(event: PaymentSucceeded, session: CheckoutSession | null, existing: Subscription | null): string | null {
  if (session?.kind === "subscription") return session.productCode;
  return existing?.planCode ?? event.planCode;
}

// Never lets a late-delivered older payment rewind the period.
function nextPeriodEnd(subscription: Subscription, reported: Date | null, paidAt: Date, plan: Plan): Date {
  const current = subscription.currentPeriodEnd;
  if (reported) return current ? laterOf(reported, current) : reported;
  const base = current ? laterOf(current, paidAt) : paidAt;
  return addInterval(base, plan.interval);
}

function toNewPayment(
  provider: PaymentProviderName,
  payment: ProviderPayment,
  status: "succeeded" | "failed",
  occurredAt: Date,
  userId: string | null,
  subscriptionId: string | null,
): NewPayment {
  return {
    userId,
    subscriptionId,
    provider,
    providerPaymentId: payment.providerPaymentId,
    status,
    amountAgorot: payment.amountAgorot,
    currency: payment.currency,
    occurredAt,
  };
}

function toUpsert(provider: PaymentProviderName, snapshot: ProviderSubscription, userId: string | null): UpsertSubscriptionInput {
  return {
    provider,
    providerSubscriptionId: snapshot.providerSubscriptionId,
    userId,
    providerCustomerId: snapshot.providerCustomerId,
    planCode: snapshot.planCode,
    status: snapshot.status,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    trialEndsAt: snapshot.trialEndsAt,
    providerUpdatedAt: snapshot.providerUpdatedAt,
  };
}

function toSubscriptionView(subscription: Subscription): SubscriptionView {
  return {
    provider: subscription.provider,
    planCode: subscription.planCode,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
  };
}

function subscriptionIdOf(event: ProviderEvent): string | null {
  switch (event.kind) {
    case "subscription.snapshot":
      return event.subscription.providerSubscriptionId;
    case "payment.succeeded":
    case "payment.failed":
    case "subscription.canceled":
      return event.providerSubscriptionId;
    case "checkout.failed":
    case "ignored":
      return null;
  }
}

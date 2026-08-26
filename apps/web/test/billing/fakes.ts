import { randomUUID } from "node:crypto";
import { CreditService } from "../../src/lib/billing/credits/service";
import { DAY_MS } from "../../src/lib/billing/dates";
import {
  ABANDONED_EVENT_MINUTES,
  MAX_EVENT_ATTEMPTS,
  isSettledStatus,
  type BillingEventStatus,
  type BillingUser,
  type CheckoutSession,
  type CreditGrant,
  type CreditUsageCursor,
  type PaymentProviderName,
  type Subscription,
} from "../../src/lib/billing/domain";
import type { BillingLogger } from "../../src/lib/billing/logger";
import type {
  AdvanceUsageInput,
  BillingEventRepository,
  BotSpend,
  CheckoutSessionRepository,
  ClaimBillingEventInput,
  ClaimBillingEventResult,
  CreditGrantRepository,
  CreditUsageRepository,
  FinishBillingEventInput,
  FirstPaymentInput,
  LlmBudgetPort,
  NewCheckoutSession,
  NewCreditGrant,
  NewPayment,
  PaymentApplication,
  PaymentRepository,
  RenewalInput,
  SubscriptionRepository,
  SubscriptionStatePatch,
  TrialClaim,
  TrialClaimRepository,
  UpsertSubscriptionInput,
  UpsertSubscriptionResult,
} from "../../src/lib/billing/ports";
import type { ProviderRegistry } from "../../src/lib/billing/provider/registry";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderSubscription,
  WebhookRequest,
} from "../../src/lib/billing/provider/types";
import { BillingService } from "../../src/lib/billing/service";

export const USER: BillingUser = { id: "user-1", email: "u@example.com", name: "Dana", betaAccess: false };
export const NOW = new Date("2026-08-26T10:00:00.000Z");
export const BOT_ID = "0f6a1c8e-3b2d-4c5e-9f1a-2b3c4d5e6f70";
const ABANDONED_MS = ABANDONED_EVENT_MINUTES * 60 * 1000;

export function last<T>(rows: readonly T[]): T {
  const row = rows[rows.length - 1];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

// Strictly increasing timestamps so "newest row" semantics are real in the fakes.
export class Clock {
  private ticks = 0;
  constructor(private base: () => Date = () => NOW) {}
  now(): Date {
    return this.base();
  }
  next(): Date {
    this.ticks += 1;
    return new Date(this.base().getTime() + this.ticks);
  }
}

export class InMemorySubscriptions implements SubscriptionRepository {
  rows: Subscription[] = [];

  constructor(private readonly clock: Clock) {}

  async findCurrentByUserId(userId: string): Promise<Subscription | null> {
    const mine = this.rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ? { ...mine[0] } : null;
  }

  async listLiveByUserId(userId: string): Promise<Subscription[]> {
    return this.rows.filter((r) => r.userId === userId && !isSettledStatus(r.status)).map((r) => ({ ...r }));
  }

  async findByProviderRef(provider: PaymentProviderName, providerSubscriptionId: string): Promise<Subscription | null> {
    const row = this.rows.find((r) => r.provider === provider && r.providerSubscriptionId === providerSubscriptionId);
    return row ? { ...row } : null;
  }

  async upsertIfNewer(input: UpsertSubscriptionInput): Promise<UpsertSubscriptionResult> {
    const existing = this.rows.find((r) => r.provider === input.provider && r.providerSubscriptionId === input.providerSubscriptionId);
    if (!existing) {
      const at = this.clock.next();
      const row: Subscription = { ...input, id: randomUUID(), createdAt: at, updatedAt: at };
      this.rows.push(row);
      return { subscription: { ...row }, applied: true };
    }
    if (existing.providerUpdatedAt.getTime() > input.providerUpdatedAt.getTime()) {
      return { subscription: { ...existing }, applied: false };
    }
    Object.assign(existing, {
      ...input,
      userId: existing.userId ?? input.userId,
      providerCustomerId: input.providerCustomerId ?? existing.providerCustomerId,
      updatedAt: this.clock.next(),
    });
    return { subscription: { ...existing }, applied: true };
  }

  async updateState(id: string, patch: SubscriptionStatePatch): Promise<Subscription> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`subscription ${id} not found`);
    Object.assign(row, patch, { updatedAt: this.clock.next() });
    return { ...row };
  }

  seed(row: Subscription): Subscription {
    this.rows.push(row);
    return row;
  }
}

export class InMemoryCheckouts implements CheckoutSessionRepository {
  rows: CheckoutSession[] = [];

  constructor(private readonly clock: Clock) {}

  async create(input: NewCheckoutSession): Promise<CheckoutSession> {
    const row: CheckoutSession = {
      ...input,
      id: randomUUID(),
      status: "pending",
      providerCheckoutId: null,
      createdAt: this.clock.next(),
      settledAt: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }

  async setProviderCheckoutId(id: string, providerCheckoutId: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.providerCheckoutId = providerCheckoutId;
  }

  async settle(id: string, status: "completed" | "failed", at: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.status === "pending") Object.assign(row, { status, settledAt: at });
  }

  async hasPendingSince(userId: string, since: Date): Promise<boolean> {
    return this.rows.some((r) => r.userId === userId && r.status === "pending" && r.createdAt.getTime() >= since.getTime());
  }

  async countOpenedSince(userId: string, since: Date): Promise<number> {
    return this.rows.filter((r) => r.userId === userId && r.createdAt.getTime() >= since.getTime()).length;
  }
}

export class InMemoryPayments implements PaymentRepository {
  rows: NewPayment[] = [];

  constructor(private readonly subscriptions: InMemorySubscriptions) {}

  async record(input: NewPayment): Promise<boolean> {
    if (this.rows.some((r) => r.provider === input.provider && r.providerPaymentId === input.providerPaymentId)) return false;
    this.rows.push({ ...input });
    return true;
  }

  async lastSucceededAmountAgorot(subscriptionId: string): Promise<number | null> {
    const mine = this.rows
      .filter((r) => r.subscriptionId === subscriptionId && r.status === "succeeded")
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return mine[0]?.amountAgorot ?? null;
  }

  async recordFirstPayment(input: FirstPaymentInput): Promise<PaymentApplication> {
    const { subscription } = await this.subscriptions.upsertIfNewer(input.subscription);
    const recorded = await this.record({ ...input.payment, subscriptionId: subscription.id });
    return recorded ? { outcome: "applied", subscription } : { outcome: "duplicate" };
  }

  async recordRenewal(input: RenewalInput): Promise<PaymentApplication> {
    const row = this.subscriptions.rows.find((r) => r.id === input.subscriptionId);
    if (!row) throw new Error("subscription missing");
    if (this.rows.some((r) => r.provider === input.payment.provider && r.providerPaymentId === input.payment.providerPaymentId)) {
      return { outcome: "duplicate" };
    }
    if ((row.currentPeriodEnd?.getTime() ?? null) !== (input.expectedPeriodEnd?.getTime() ?? null)) return { outcome: "conflict" };
    this.rows.push({ ...input.payment, subscriptionId: input.subscriptionId });
    const subscription = await this.subscriptions.updateState(input.subscriptionId, input.patch);
    return { outcome: "applied", subscription };
  }
}

export class InMemoryGrants implements CreditGrantRepository {
  rows: CreditGrant[] = [];

  constructor(private readonly clock: Clock) {}

  async listByUserId(userId: string): Promise<CreditGrant[]> {
    return this.rows.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }

  async insertIfAbsent(input: NewCreditGrant): Promise<CreditGrant | null> {
    if (this.rows.some((r) => r.sourceRef === input.sourceRef)) return null;
    const row: CreditGrant = { ...input, id: randomUUID(), usedCredits: 0, grantedAt: this.clock.next() };
    this.rows.push(row);
    return { ...row };
  }

  async listUserIdsWithGrants(): Promise<string[]> {
    return [...new Set(this.rows.map((r) => r.userId))];
  }
}

// Mirrors the SQL: a null holder is a claim by a deleted account and still blocks everyone else.
export class InMemoryTrialClaims implements TrialClaimRepository {
  rows = new Map<string, string | null>();

  async findClaimant(emailHash: string): Promise<TrialClaim | null> {
    const holder = this.rows.get(emailHash);
    return holder === undefined ? null : { userId: holder };
  }

  async claim(emailHash: string, userId: string): Promise<boolean> {
    const holder = this.rows.get(emailHash);
    if (holder !== undefined && holder !== userId) return false;
    this.rows.set(emailHash, userId);
    return true;
  }

  forgetUser(userId: string): void {
    for (const [hash, holder] of this.rows) if (holder === userId) this.rows.set(hash, null);
  }
}

export class InMemoryUsage implements CreditUsageRepository {
  rows: CreditUsageCursor[] = [];
  advances = 0;
  // Bumps the cursor version right before the next advance, as a concurrent sync would.
  interfereNext = false;

  constructor(private readonly grants: InMemoryGrants) {}

  async findByBotId(botId: string): Promise<CreditUsageCursor | null> {
    const row = this.rows.find((r) => r.botId === botId);
    return row ? { ...row } : null;
  }

  async listByUserId(userId: string): Promise<CreditUsageCursor[]> {
    return this.rows.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }

  // Mirrors the SQL: version-guarded upsert, then attributions that must fit inside each grant, all-or-nothing.
  async advance(input: AdvanceUsageInput): Promise<boolean> {
    this.advances += 1;
    if (this.interfereNext) {
      this.interfereNext = false;
      const victim = this.rows.find((r) => r.botId === input.botId);
      if (victim) victim.version += 1;
      else this.rows.push({ ...emptyCursor(input), version: 1 });
      return false;
    }
    const row = this.rows.find((r) => r.botId === input.botId);
    if (row ? row.version !== input.expectedVersion : false) return false;
    for (const attribution of input.attributions) {
      const grant = this.grants.rows.find((g) => g.id === attribution.grantId);
      if (!grant || grant.usedCredits + attribution.credits > grant.credits) return false;
    }
    if (row) {
      Object.assign(row, {
        lastSpendUsdCents: input.spendUsdCents,
        consumedCredits: row.consumedCredits + input.consumedDelta,
        unallocatedCredits: row.unallocatedCredits + input.unallocatedDelta,
        version: row.version + 1,
        syncedAt: input.syncedAt,
      });
    } else {
      this.rows.push({
        ...emptyCursor(input),
        lastSpendUsdCents: input.spendUsdCents,
        consumedCredits: input.consumedDelta,
        unallocatedCredits: input.unallocatedDelta,
        version: 1,
        syncedAt: input.syncedAt,
      });
    }
    for (const attribution of input.attributions) {
      const grant = this.grants.rows.find((g) => g.id === attribution.grantId);
      if (grant) grant.usedCredits += attribution.credits;
    }
    return true;
  }
}

function emptyCursor(input: AdvanceUsageInput): CreditUsageCursor {
  return {
    botId: input.botId,
    userId: input.userId,
    lastSpendUsdCents: 0,
    consumedCredits: 0,
    unallocatedCredits: 0,
    version: 0,
    syncedAt: input.syncedAt,
  };
}

export class FakeLlm implements LlmBudgetPort {
  bots = new Map<string, { userId: string; spend: BotSpend }>();
  ceilings: Array<{ botId: string; cents: number }> = [];
  readCalls = 0;
  failReadsFor = new Set<string>();

  addBot(userId: string, botId: string, spend: Partial<BotSpend> = {}): void {
    this.bots.set(botId, {
      userId,
      spend: { botId, supported: true, spendUsdCents: 0, maxBudgetUsdCents: 5000, ...spend },
    });
  }

  setSpend(botId: string, patch: Partial<BotSpend>): void {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error("unknown bot");
    Object.assign(bot.spend, patch);
  }

  async listLiveBotIds(userId: string): Promise<string[]> {
    return [...this.bots.entries()].filter(([, b]) => b.userId === userId).map(([id]) => id);
  }

  async readSpend(_userId: string, botId: string): Promise<BotSpend> {
    this.readCalls += 1;
    if (this.failReadsFor.has(botId)) throw new Error("gateway unreachable");
    const bot = this.bots.get(botId);
    if (!bot) throw new Error("unknown bot");
    return { ...bot.spend };
  }

  async setCeiling(_userId: string, botId: string, maxBudgetUsdCents: number): Promise<void> {
    this.ceilings.push({ botId, cents: maxBudgetUsdCents });
    this.setSpend(botId, { maxBudgetUsdCents });
  }

  lastCeiling(botId: string): number | null {
    const mine = this.ceilings.filter((c) => c.botId === botId);
    return mine.length > 0 ? last(mine).cents : null;
  }
}

interface StoredEvent {
  id: string;
  key: string;
  status: BillingEventStatus;
  userId: string | null;
  note: string | null;
  attempts: number;
  receivedAt: Date;
}

export class InMemoryEvents implements BillingEventRepository {
  rows: StoredEvent[] = [];

  constructor(private readonly clock: Clock) {}

  async claim(input: ClaimBillingEventInput): Promise<ClaimBillingEventResult> {
    const key = `${input.provider}:${input.providerEventId}`;
    const now = this.clock.now();
    const existing = this.rows.find((r) => r.key === key);
    if (!existing) {
      const row: StoredEvent = { id: randomUUID(), key, status: "received", userId: null, note: null, attempts: 1, receivedAt: now };
      this.rows.push(row);
      return { kind: "new", id: row.id };
    }
    const abandoned = existing.status === "received" && now.getTime() - existing.receivedAt.getTime() > ABANDONED_MS;
    if ((existing.status === "failed" || abandoned) && existing.attempts < MAX_EVENT_ATTEMPTS) {
      Object.assign(existing, { status: "received", note: null, attempts: existing.attempts + 1, receivedAt: now });
      return { kind: "retry", id: existing.id };
    }
    return { kind: "duplicate", status: existing.status };
  }

  async finish(id: string, input: FinishBillingEventInput): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error("event not found");
    row.status = input.status;
    row.note = input.note ?? null;
    if (input.userId !== undefined) row.userId = input.userId;
  }
}

type Call = { method: string; args: unknown[] };

export class FakeProvider implements PaymentProvider {
  readonly name = "mock" as const;
  available = true;
  capabilities: ProviderCapabilities = { cancel: true, resume: true, customerPortal: true, updatePaymentMethod: true };
  calls: Call[] = [];
  checkoutInputs: CreateCheckoutInput[] = [];
  nextEvent: ProviderEvent | Error | null = null;
  cancelResult: ProviderSubscription | null = null;
  resumeResult: ProviderSubscription | null = null;
  portalUrl: string | null = "https://portal.example/abc";
  updatePaymentMethodUrl: string | null = "https://update.example/abc";

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    this.calls.push({ method: "createCheckout", args: [input] });
    this.checkoutInputs.push(input);
    return { url: `https://pay.example/${input.checkoutSessionId}`, providerCheckoutId: `chk_${input.checkoutSessionId}` };
  }

  async parseWebhook(request: WebhookRequest): Promise<ProviderEvent> {
    this.calls.push({ method: "parseWebhook", args: [request] });
    if (this.nextEvent instanceof Error) throw this.nextEvent;
    if (!this.nextEvent) throw new Error("FakeProvider.nextEvent not set");
    return this.nextEvent;
  }

  async cancelSubscription(id: string): Promise<ProviderSubscription | null> {
    this.calls.push({ method: "cancelSubscription", args: [id] });
    return this.cancelResult;
  }

  async resumeSubscription(id: string): Promise<ProviderSubscription | null> {
    this.calls.push({ method: "resumeSubscription", args: [id] });
    return this.resumeResult;
  }

  async getCustomerPortalUrl(id: string): Promise<string | null> {
    this.calls.push({ method: "getCustomerPortalUrl", args: [id] });
    return this.portalUrl;
  }

  async getUpdatePaymentMethodUrl(id: string, returnUrl: string): Promise<string | null> {
    this.calls.push({ method: "getUpdatePaymentMethodUrl", args: [id, returnUrl] });
    return this.updatePaymentMethodUrl;
  }

  callsTo(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }
}

export interface Logs {
  warnings: string[];
  errors: string[];
}

export function capturingLogger(logs: Logs): BillingLogger {
  return {
    info() {},
    warn: (message) => logs.warnings.push(message),
    error: (message) => logs.errors.push(message),
  };
}

export const silentLogger: BillingLogger = { info() {}, warn() {}, error() {} };

export interface CreditHarness {
  clock: Clock;
  credits: CreditService;
  grants: InMemoryGrants;
  usage: InMemoryUsage;
  llm: FakeLlm;
  logs: Logs;
}

export function creditHarness(opts: { now?: () => Date } = {}): CreditHarness {
  const clock = new Clock(opts.now);
  const grants = new InMemoryGrants(clock);
  const usage = new InMemoryUsage(grants);
  const llm = new FakeLlm();
  const logs: Logs = { warnings: [], errors: [] };
  const credits = new CreditService({ grants, usage, llm, now: () => clock.now(), logger: capturingLogger(logs) });
  return { clock, credits, grants, usage, llm, logs };
}

export interface Harness extends CreditHarness {
  service: BillingService;
  provider: FakeProvider;
  subscriptions: InMemorySubscriptions;
  checkouts: InMemoryCheckouts;
  payments: InMemoryPayments;
  events: InMemoryEvents;
  trialClaims: InMemoryTrialClaims;
}

export function harness(opts: { enforcement?: boolean; now?: () => Date; providerAvailable?: boolean } = {}): Harness {
  const base = creditHarness(opts);
  const provider = new FakeProvider();
  provider.available = opts.providerAvailable ?? true;
  const registry: ProviderRegistry = {
    active: provider,
    byName: (name) => (name === provider.name && provider.available ? provider : null),
  };
  const subscriptions = new InMemorySubscriptions(base.clock);
  const checkouts = new InMemoryCheckouts(base.clock);
  const payments = new InMemoryPayments(subscriptions);
  const events = new InMemoryEvents(base.clock);
  const trialClaims = new InMemoryTrialClaims();
  const service = new BillingService({
    providers: registry,
    subscriptions,
    checkouts,
    payments,
    events,
    trialClaims,
    credits: base.credits,
    enforcement: opts.enforcement ?? true,
    appUrl: "https://app.example",
    now: () => base.clock.now(),
    logger: capturingLogger(base.logs),
  });
  return { ...base, service, provider, subscriptions, checkouts, payments, events, trialClaims };
}

export function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: randomUUID(),
    userId: USER.id,
    provider: "mock",
    providerSubscriptionId: "sub_1",
    providerCustomerId: "cus_1",
    planCode: "standard",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-09-26T10:00:00.000Z"),
    trialEndsAt: null,
    providerUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function trialGrant(now: Date, overrides: Partial<CreditGrant> = {}): CreditGrant {
  return grant({ kind: "trial", credits: 400, sourceRef: `trial:${USER.id}`, expiresAt: new Date(now.getTime() + 7 * DAY_MS), ...overrides });
}

export function grant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: randomUUID(),
    userId: USER.id,
    kind: "plan",
    credits: 1000,
    usedCredits: 0,
    sourceRef: `ref:${randomUUID()}`,
    grantedAt: NOW,
    expiresAt: new Date("2026-09-29T10:00:00.000Z"),
    ...overrides,
  };
}

export const emptyRequest: WebhookRequest = { rawBody: "{}", header: () => null };

let eventCounter = 0;
export function nextEventId(): string {
  eventCounter += 1;
  return `evt_${eventCounter}`;
}

export function paymentSucceeded(
  overrides: Partial<Extract<ProviderEvent, { kind: "payment.succeeded" }>> = {},
): Extract<ProviderEvent, { kind: "payment.succeeded" }> {
  return {
    kind: "payment.succeeded",
    providerEventId: nextEventId(),
    eventType: "payment.succeeded",
    occurredAt: NOW,
    payload: {},
    providerSubscriptionId: "sub_1",
    providerCustomerId: "cus_1",
    planCode: "standard",
    payment: { providerPaymentId: "pay_1", amountAgorot: 20000, currency: "ILS" },
    periodEnd: null,
    reference: { checkoutSessionId: null },
    ...overrides,
  };
}

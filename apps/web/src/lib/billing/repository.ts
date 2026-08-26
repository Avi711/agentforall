import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, not, or, sql } from "drizzle-orm";
import {
  billingCheckoutSessions,
  billingCreditGrants,
  billingCreditUsage,
  billingEvents,
  billingPayments,
  billingSubscriptions,
  billingTrialClaims,
  type Database,
  type Transaction,
} from "@agent-forall/db";
import { getDb } from "../db";
import {
  ABANDONED_EVENT_MINUTES,
  MAX_EVENT_ATTEMPTS,
  SETTLED_SUBSCRIPTION_STATUSES,
  type CheckoutSession,
  type CreditGrant,
  type CreditUsageCursor,
  type PaymentProviderName,
  type Subscription,
} from "./domain";
import type {
  AdvanceUsageInput,
  BillingEventRepository,
  CheckoutSessionRepository,
  ClaimBillingEventInput,
  ClaimBillingEventResult,
  CreditGrantRepository,
  CreditUsageRepository,
  FinishBillingEventInput,
  FirstPaymentInput,
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
} from "./ports";

type SubscriptionRow = typeof billingSubscriptions.$inferSelect;
type CheckoutRow = typeof billingCheckoutSessions.$inferSelect;
type GrantRow = typeof billingCreditGrants.$inferSelect;
type UsageRow = typeof billingCreditUsage.$inferSelect;
type Executor = Database | Transaction;

const ABANDONED_EVENT_INTERVAL = sql`make_interval(mins => ${ABANDONED_EVENT_MINUTES})`;

class TransactionConflict extends Error {}

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async findCurrentByUserId(userId: string): Promise<Subscription | null> {
    const rows = await this.db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.userId, userId))
      .orderBy(desc(billingSubscriptions.createdAt))
      .limit(1);
    return rows[0] ? toSubscription(rows[0]) : null;
  }

  async listLiveByUserId(userId: string): Promise<Subscription[]> {
    const rows = await this.db
      .select()
      .from(billingSubscriptions)
      .where(
        and(
          eq(billingSubscriptions.userId, userId),
          not(inArray(billingSubscriptions.status, SETTLED_SUBSCRIPTION_STATUSES)),
        ),
      )
      .orderBy(desc(billingSubscriptions.createdAt));
    return rows.map(toSubscription);
  }

  async findByProviderRef(provider: PaymentProviderName, providerSubscriptionId: string): Promise<Subscription | null> {
    return findByProviderRef(this.db, provider, providerSubscriptionId);
  }

  async upsertIfNewer(input: UpsertSubscriptionInput): Promise<UpsertSubscriptionResult> {
    return upsertIfNewer(this.db, input);
  }

  async updateState(id: string, patch: SubscriptionStatePatch): Promise<Subscription> {
    const rows = await this.db
      .update(billingSubscriptions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(billingSubscriptions.id, id))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`subscription ${id} not found`);
    return toSubscription(row);
  }
}

export class DrizzleCheckoutSessionRepository implements CheckoutSessionRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async create(input: NewCheckoutSession): Promise<CheckoutSession> {
    const rows = await this.db.insert(billingCheckoutSessions).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error("checkout session insert returned no row");
    return toCheckoutSession(row);
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    const rows = await this.db
      .select()
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.id, id))
      .limit(1);
    return rows[0] ? toCheckoutSession(rows[0]) : null;
  }

  async setProviderCheckoutId(id: string, providerCheckoutId: string): Promise<void> {
    await this.db
      .update(billingCheckoutSessions)
      .set({ providerCheckoutId })
      .where(eq(billingCheckoutSessions.id, id));
  }

  async settle(id: string, status: "completed" | "failed", at: Date): Promise<void> {
    await this.db
      .update(billingCheckoutSessions)
      .set({ status, settledAt: at })
      .where(and(eq(billingCheckoutSessions.id, id), eq(billingCheckoutSessions.status, "pending")));
  }

  async hasPendingSince(userId: string, since: Date): Promise<boolean> {
    const rows = await this.db
      .select({ id: billingCheckoutSessions.id })
      .from(billingCheckoutSessions)
      .where(
        and(
          eq(billingCheckoutSessions.userId, userId),
          eq(billingCheckoutSessions.status, "pending"),
          gte(billingCheckoutSessions.createdAt, since),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async countOpenedSince(userId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(billingCheckoutSessions)
      .where(and(eq(billingCheckoutSessions.userId, userId), gte(billingCheckoutSessions.createdAt, since)));
    return rows[0]?.count ?? 0;
  }
}

export class DrizzlePaymentRepository implements PaymentRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async record(input: NewPayment): Promise<boolean> {
    return insertPayment(this.db, input);
  }

  async lastSucceededAmountAgorot(subscriptionId: string): Promise<number | null> {
    const rows = await this.db
      .select({ amountAgorot: billingPayments.amountAgorot })
      .from(billingPayments)
      .where(and(eq(billingPayments.subscriptionId, subscriptionId), eq(billingPayments.status, "succeeded")))
      .orderBy(desc(billingPayments.occurredAt))
      .limit(1);
    return rows[0]?.amountAgorot ?? null;
  }

  async recordFirstPayment(input: FirstPaymentInput): Promise<PaymentApplication> {
    return this.db.transaction(async (tx) => {
      const { subscription } = await upsertIfNewer(tx, input.subscription);
      const recorded = await insertPayment(tx, { ...input.payment, subscriptionId: subscription.id });
      return recorded ? { outcome: "applied", subscription } : { outcome: "duplicate" };
    });
  }

  async recordRenewal(input: RenewalInput): Promise<PaymentApplication> {
    try {
      return await this.db.transaction(async (tx) => {
        const recorded = await insertPayment(tx, { ...input.payment, subscriptionId: input.subscriptionId });
        if (!recorded) return { outcome: "duplicate" };
        const rows = await tx
          .update(billingSubscriptions)
          .set({ ...input.patch, updatedAt: new Date() })
          .where(
            and(
              eq(billingSubscriptions.id, input.subscriptionId),
              sql`${billingSubscriptions.currentPeriodEnd} IS NOT DISTINCT FROM ${input.expectedPeriodEnd}`,
            ),
          )
          .returning();
        const row = rows[0];
        if (!row) throw new TransactionConflict();
        return { outcome: "applied", subscription: toSubscription(row) };
      });
    } catch (err) {
      if (err instanceof TransactionConflict) return { outcome: "conflict" };
      throw err;
    }
  }
}

export class DrizzleCreditGrantRepository implements CreditGrantRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async listByUserId(userId: string): Promise<CreditGrant[]> {
    const rows = await this.db
      .select()
      .from(billingCreditGrants)
      .where(eq(billingCreditGrants.userId, userId))
      .orderBy(billingCreditGrants.grantedAt);
    return rows.map(toGrant);
  }

  async insertIfAbsent(input: NewCreditGrant): Promise<CreditGrant | null> {
    const rows = await this.db
      .insert(billingCreditGrants)
      .values(input)
      .onConflictDoNothing({ target: billingCreditGrants.sourceRef })
      .returning();
    return rows[0] ? toGrant(rows[0]) : null;
  }

  async listUserIdsWithGrants(): Promise<string[]> {
    const lastSync = sql<Date | null>`min(${billingCreditUsage.syncedAt})`;
    const rows = await this.db
      .select({ userId: billingCreditGrants.userId })
      .from(billingCreditGrants)
      .leftJoin(billingCreditUsage, eq(billingCreditUsage.userId, billingCreditGrants.userId))
      .groupBy(billingCreditGrants.userId)
      .orderBy(sql`${lastSync} asc nulls first`);
    return rows.map((r) => r.userId);
  }
}

export class DrizzleTrialClaimRepository implements TrialClaimRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async findClaimant(emailHash: string): Promise<TrialClaim | null> {
    const rows = await this.db
      .select({ userId: billingTrialClaims.userId })
      .from(billingTrialClaims)
      .where(eq(billingTrialClaims.emailHash, emailHash))
      .limit(1);
    return rows[0] ? { userId: rows[0].userId } : null;
  }

  async claim(emailHash: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .insert(billingTrialClaims)
      .values({ emailHash, userId })
      .onConflictDoUpdate({
        target: billingTrialClaims.emailHash,
        set: { userId },
        setWhere: eq(billingTrialClaims.userId, userId),
      })
      .returning({ emailHash: billingTrialClaims.emailHash });
    return rows.length > 0;
  }
}

export class DrizzleCreditUsageRepository implements CreditUsageRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async findByBotId(botId: string): Promise<CreditUsageCursor | null> {
    const rows = await this.db.select().from(billingCreditUsage).where(eq(billingCreditUsage.botId, botId)).limit(1);
    return rows[0] ? toCursor(rows[0]) : null;
  }

  async listByUserId(userId: string): Promise<CreditUsageCursor[]> {
    const rows = await this.db.select().from(billingCreditUsage).where(eq(billingCreditUsage.userId, userId));
    return rows.map(toCursor);
  }

  async advance(input: AdvanceUsageInput): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(billingCreditUsage)
          .values({
            botId: input.botId,
            userId: input.userId,
            lastSpendUsdCents: input.spendUsdCents,
            consumedCredits: input.consumedDelta,
            unallocatedCredits: input.unallocatedDelta,
            version: 1,
            syncedAt: input.syncedAt,
          })
          .onConflictDoUpdate({
            target: billingCreditUsage.botId,
            set: {
              lastSpendUsdCents: input.spendUsdCents,
              consumedCredits: sql`${billingCreditUsage.consumedCredits} + ${input.consumedDelta}`,
              unallocatedCredits: sql`${billingCreditUsage.unallocatedCredits} + ${input.unallocatedDelta}`,
              version: sql`${billingCreditUsage.version} + 1`,
              syncedAt: input.syncedAt,
            },
            setWhere: eq(billingCreditUsage.version, input.expectedVersion),
          })
          .returning({ botId: billingCreditUsage.botId });
        if (rows.length === 0) throw new TransactionConflict();

        for (const attribution of input.attributions) {
          const updated = await tx
            .update(billingCreditGrants)
            .set({ usedCredits: sql`${billingCreditGrants.usedCredits} + ${attribution.credits}` })
            .where(
              and(
                eq(billingCreditGrants.id, attribution.grantId),
                sql`${billingCreditGrants.usedCredits} + ${attribution.credits} <= ${billingCreditGrants.credits}`,
              ),
            )
            .returning({ id: billingCreditGrants.id });
          if (updated.length === 0) throw new TransactionConflict();
        }
      });
      return true;
    } catch (err) {
      if (err instanceof TransactionConflict) return false;
      throw err;
    }
  }
}

export class DrizzleBillingEventRepository implements BillingEventRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async claim(input: ClaimBillingEventInput): Promise<ClaimBillingEventResult> {
    const inserted = await this.db
      .insert(billingEvents)
      .values({
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        providerSubscriptionId: input.providerSubscriptionId,
        payload: input.payload,
      })
      .onConflictDoNothing({ target: [billingEvents.provider, billingEvents.providerEventId] })
      .returning({ id: billingEvents.id });
    if (inserted[0]) return { kind: "new", id: inserted[0].id };

    const sameEvent = and(eq(billingEvents.provider, input.provider), eq(billingEvents.providerEventId, input.providerEventId));
    const reclaimed = await this.db
      .update(billingEvents)
      .set({
        status: "received",
        note: null,
        processedAt: null,
        attempts: sql`${billingEvents.attempts} + 1`,
        receivedAt: sql`now()`,
      })
      .where(
        and(
          sameEvent,
          lt(billingEvents.attempts, MAX_EVENT_ATTEMPTS),
          or(
            eq(billingEvents.status, "failed"),
            and(eq(billingEvents.status, "received"), sql`${billingEvents.receivedAt} < now() - ${ABANDONED_EVENT_INTERVAL}`),
          ),
        ),
      )
      .returning({ id: billingEvents.id });
    if (reclaimed[0]) return { kind: "retry", id: reclaimed[0].id };

    const existing = await this.db.select({ status: billingEvents.status }).from(billingEvents).where(sameEvent).limit(1);
    const row = existing[0];
    if (!row) throw new Error("billing event conflict but no row found");
    return { kind: "duplicate", status: row.status };
  }

  async finish(id: string, input: FinishBillingEventInput): Promise<void> {
    await this.db
      .update(billingEvents)
      .set({
        status: input.status,
        note: input.note ?? null,
        processedAt: new Date(),
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
      })
      .where(eq(billingEvents.id, id));
  }
}

async function findByProviderRef(
  db: Executor,
  provider: PaymentProviderName,
  providerSubscriptionId: string,
): Promise<Subscription | null> {
  const rows = await db
    .select()
    .from(billingSubscriptions)
    .where(
      and(eq(billingSubscriptions.provider, provider), eq(billingSubscriptions.providerSubscriptionId, providerSubscriptionId)),
    )
    .limit(1);
  return rows[0] ? toSubscription(rows[0]) : null;
}

async function upsertIfNewer(db: Executor, input: UpsertSubscriptionInput): Promise<UpsertSubscriptionResult> {
  const now = new Date();
  const updated = await db
    .insert(billingSubscriptions)
    .values({ ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: [billingSubscriptions.provider, billingSubscriptions.providerSubscriptionId],
      set: {
        userId: sql`coalesce(${billingSubscriptions.userId}, excluded.user_id)`,
        providerCustomerId: sql`coalesce(excluded.provider_customer_id, ${billingSubscriptions.providerCustomerId})`,
        planCode: sql`excluded.plan_code`,
        status: sql`excluded.status`,
        cancelAtPeriodEnd: sql`excluded.cancel_at_period_end`,
        currentPeriodEnd: sql`excluded.current_period_end`,
        trialEndsAt: sql`excluded.trial_ends_at`,
        providerUpdatedAt: sql`excluded.provider_updated_at`,
        updatedAt: now,
      },
      // `<=` so a same-instant snapshot still applies; only strictly older ones are dropped.
      setWhere: sql`${billingSubscriptions.providerUpdatedAt} <= excluded.provider_updated_at`,
    })
    .returning();
  if (updated[0]) return { subscription: toSubscription(updated[0]), applied: true };

  const existing = await findByProviderRef(db, input.provider, input.providerSubscriptionId);
  if (!existing) throw new Error("subscription upsert returned no row and none exists");
  return { subscription: existing, applied: false };
}

async function insertPayment(db: Executor, input: NewPayment): Promise<boolean> {
  const inserted = await db
    .insert(billingPayments)
    .values(input)
    .onConflictDoNothing({ target: [billingPayments.provider, billingPayments.providerPaymentId] })
    .returning({ id: billingPayments.id });
  return inserted.length > 0;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerSubscriptionId: row.providerSubscriptionId,
    providerCustomerId: row.providerCustomerId,
    planCode: row.planCode,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    trialEndsAt: row.trialEndsAt,
    providerUpdatedAt: row.providerUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCheckoutSession(row: CheckoutRow): CheckoutSession {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    kind: row.kind,
    productCode: row.productCode,
    credits: row.credits,
    amountAgorot: row.amountAgorot,
    status: row.status,
    providerCheckoutId: row.providerCheckoutId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    settledAt: row.settledAt,
  };
}

function toGrant(row: GrantRow): CreditGrant {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    credits: row.credits,
    usedCredits: row.usedCredits,
    sourceRef: row.sourceRef,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
  };
}

function toCursor(row: UsageRow): CreditUsageCursor {
  return {
    botId: row.botId,
    userId: row.userId,
    lastSpendUsdCents: row.lastSpendUsdCents,
    consumedCredits: row.consumedCredits,
    unallocatedCredits: row.unallocatedCredits,
    version: row.version,
    syncedAt: row.syncedAt,
  };
}

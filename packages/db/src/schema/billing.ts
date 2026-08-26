import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const PAYMENT_PROVIDERS = ["mock"] as const;

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
  "unpaid",
  "expired",
] as const;

export const CHECKOUT_KINDS = ["subscription", "topup"] as const;

export const CHECKOUT_SESSION_STATUSES = ["pending", "completed", "failed"] as const;

export const PAYMENT_STATUSES = ["succeeded", "failed", "refunded"] as const;

export const BILLING_EVENT_STATUSES = ["received", "processed", "ignored", "failed"] as const;

export const CREDIT_GRANT_KINDS = ["trial", "plan", "topup"] as const;

export const billingCheckoutSessions = pgTable(
  "billing_checkout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32, enum: PAYMENT_PROVIDERS }).notNull(),
    kind: varchar("kind", { length: 16, enum: CHECKOUT_KINDS }).notNull(),
    // Subscription: the plan code. Top-up: `topup_ils_<amount>`.
    productCode: varchar("product_code", { length: 32 }).notNull(),
    credits: integer("credits").notNull(),
    amountAgorot: integer("amount_agorot").notNull(),
    status: varchar("status", { length: 16, enum: CHECKOUT_SESSION_STATUSES })
      .notNull()
      .default("pending"),
    providerCheckoutId: varchar("provider_checkout_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Passed to the provider as the hosted page's lifetime; correlation itself never expires.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("idx_billing_checkout_sessions_user_created").on(t.userId, t.createdAt)],
);

// user_id nullable + set null: the financial record must outlive the account.
export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 32, enum: PAYMENT_PROVIDERS }).notNull(),
    providerSubscriptionId: varchar("provider_subscription_id", { length: 128 }).notNull(),
    providerCustomerId: varchar("provider_customer_id", { length: 128 }),
    planCode: varchar("plan_code", { length: 32 }).notNull(),
    status: varchar("status", { length: 16, enum: SUBSCRIPTION_STATUSES }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_billing_subscriptions_provider_ref").on(t.provider, t.providerSubscriptionId),
    index("idx_billing_subscriptions_user_id").on(t.userId),
  ],
);

export const billingPayments = pgTable(
  "billing_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => billingSubscriptions.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 32, enum: PAYMENT_PROVIDERS }).notNull(),
    providerPaymentId: varchar("provider_payment_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 16, enum: PAYMENT_STATUSES }).notNull(),
    amountAgorot: integer("amount_agorot").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_billing_payments_provider_ref").on(t.provider, t.providerPaymentId),
    index("idx_billing_payments_subscription_id").on(t.subscriptionId),
    index("idx_billing_payments_user_id").on(t.userId),
  ],
);

// Credits a user may spend. `used_credits` is attributed at sync time and only ever grows.
export const billingCreditGrants = pgTable(
  "billing_credit_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16, enum: CREDIT_GRANT_KINDS }).notNull(),
    credits: integer("credits").notNull(),
    usedCredits: integer("used_credits").notNull().default(0),
    // Idempotency key: `trial:<userId>`, `plan:<provider>:<paymentId>`, `topup:<provider>:<paymentId>`.
    sourceRef: varchar("source_ref", { length: 200 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("idx_billing_credit_grants_source_ref").on(t.sourceRef),
    index("idx_billing_credit_grants_user_id").on(t.userId),
  ],
);

// Per-bot cursor into the gateway's cumulative spend; a drop in spend means the counter restarted.
export const billingCreditUsage = pgTable(
  "billing_credit_usage",
  {
    botId: uuid("bot_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastSpendUsdCents: integer("last_spend_usd_cents").notNull().default(0),
    consumedCredits: integer("consumed_credits").notNull().default(0),
    // Spend that landed with no grant left to absorb it (stale ceiling); reported, never hidden.
    unallocatedCredits: integer("unallocated_credits").notNull().default(0),
    version: integer("version").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_billing_credit_usage_user_id").on(t.userId)],
);

// Webhook inbox: unique provider_event_id makes redelivery idempotent; payload kept for audit.
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 32, enum: PAYMENT_PROVIDERS }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    status: varchar("status", { length: 16, enum: BILLING_EVENT_STATUSES })
      .notNull()
      .default("received"),
    userId: text("user_id"),
    providerSubscriptionId: varchar("provider_subscription_id", { length: 128 }),
    payload: jsonb("payload").notNull(),
    note: text("note"),
    // Deliveries claimed so far; a poison event stops being retried past MAX_EVENT_ATTEMPTS.
    attempts: integer("attempts").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("idx_billing_events_provider_event").on(t.provider, t.providerEventId),
    index("idx_billing_events_subscription").on(t.provider, t.providerSubscriptionId),
  ],
);

// Outlives the account (set null) so deleting and re-registering never earns a second trial.
export const billingTrialClaims = pgTable("billing_trial_claims", {
  emailHash: varchar("email_hash", { length: 64 }).primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
});

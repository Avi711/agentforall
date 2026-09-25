import { z } from "zod";

export const PADDLE_SIGNATURE_HEADER = "paddle-signature";

// Our correlation key inside Paddle `custom_data`; Paddle copies it from the checkout transaction to the subscription.
export const CHECKOUT_SESSION_KEY = "checkout_session_id";

export const PRICE_PLAN_KEY = "agentforall_plan";

// Paddle lets the buyer change quantity (1–100 by default) unless the price pins it; one unit is one grant.
export const SINGLE_UNIT = { minimum: 1, maximum: 1 } as const;

const Timestamp = z.string().datetime({ offset: true });

const Period = z.object({ starts_at: Timestamp, ends_at: Timestamp });

const CustomData = z.record(z.string(), z.unknown()).nullable().optional();

const Item = z.object({ price: z.object({ id: z.string().min(1), custom_data: CustomData }).nullable().optional() });
export type PaddleItem = z.infer<typeof Item>;

export const PaddleTransactionSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  customer_id: z.string().nullable(),
  subscription_id: z.string().nullable(),
  custom_data: CustomData,
  currency_code: z.string().length(3),
  origin: z.string(),
  billing_period: Period.nullable().optional(),
  items: z.array(Item),
  // `total` is the value after discount and tax; `grand_total` would also subtract the customer's Paddle credit balance.
  details: z.object({ totals: z.object({ total: z.string().regex(/^\d+$/) }) }).nullable().optional(),
  checkout: z.object({ url: z.string().url().nullable() }).nullable().optional(),
});
export type PaddleTransaction = z.infer<typeof PaddleTransactionSchema>;

const PADDLE_SUBSCRIPTION_STATUSES = ["active", "canceled", "past_due", "paused", "trialing"] as const;

export const PaddleSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(PADDLE_SUBSCRIPTION_STATUSES),
  customer_id: z.string().min(1),
  custom_data: CustomData,
  items: z.array(Item),
  current_billing_period: Period.nullable().optional(),
  scheduled_change: z
    .object({ action: z.enum(["cancel", "pause", "resume"]), effective_at: Timestamp })
    .nullable()
    .optional(),
  updated_at: Timestamp,
});
export type PaddleSubscription = z.infer<typeof PaddleSubscriptionSchema>;

export const PaddleAdjustmentSchema = z.object({
  id: z.string().min(1),
  action: z.string(),
  status: z.string(),
  type: z.enum(["full", "partial"]).optional(),
  transaction_id: z.string().min(1),
  subscription_id: z.string().nullable().optional(),
});

export const PaddlePortalSessionSchema = z.object({
  urls: z.object({ general: z.object({ overview: z.string().url() }) }),
});

export const PaddleEnvelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: Timestamp,
  data: z.unknown(),
});

export const PaddleErrorSchema = z.object({
  error: z.object({ code: z.string(), detail: z.string().optional() }),
});

export function customDataSessionId(customData: Record<string, unknown> | null | undefined): string | null {
  const parsed = z.string().uuid().safeParse(customData?.[CHECKOUT_SESSION_KEY]);
  return parsed.success ? parsed.data : null;
}

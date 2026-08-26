import { z } from "zod";

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

const PaymentSchema = z.object({
  id: z.string().min(1),
  amountAgorot: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

const BaseSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
});

export const MockWebhookSchema = z.discriminatedUnion("type", [
  BaseSchema.extend({
    type: z.literal("checkout.completed"),
    checkoutSessionId: z.string().uuid(),
    mode: z.enum(["subscription", "one_time"]),
    // Null for a one-time charge.
    subscriptionId: z.string().min(1).nullable(),
    customerId: z.string().min(1),
    productCode: z.string().min(1),
    payment: PaymentSchema,
  }),
  BaseSchema.extend({
    type: z.literal("checkout.failed"),
    checkoutSessionId: z.string().uuid(),
    reason: z.string().nullable(),
  }),
  BaseSchema.extend({
    type: z.literal("payment.succeeded"),
    subscriptionId: z.string().min(1),
    payment: PaymentSchema,
  }),
  BaseSchema.extend({
    type: z.literal("payment.failed"),
    subscriptionId: z.string().min(1),
    payment: PaymentSchema.nullable(),
    reason: z.string().nullable(),
  }),
  BaseSchema.extend({
    type: z.literal("subscription.canceled"),
    subscriptionId: z.string().min(1),
    accessEndsAt: z.string().datetime({ offset: true }).nullable(),
  }),
]);

export type MockWebhookEvent = z.infer<typeof MockWebhookSchema>;

import { z } from "zod";
import { PLAN_CODES, TOPUP_MAX_ILS, TOPUP_MIN_ILS } from "./pricing";

export const CheckoutBodySchema = z.object({ plan: z.enum(PLAN_CODES) }).strict();

export const ChangePlanBodySchema = z.object({ plan: z.enum(PLAN_CODES) }).strict();

export const TopupBodySchema = z
  .object({ amountIls: z.number().int().min(TOPUP_MIN_ILS).max(TOPUP_MAX_ILS) })
  .strict();

export const WebhookProviderParamsSchema = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{1,32}$/),
});

export const MockCheckoutOutcomeSchema = z.enum(["success", "failure"]);
export type MockCheckoutOutcome = z.infer<typeof MockCheckoutOutcomeSchema>;

export const MockCheckoutCompleteBodySchema = z
  .object({ sessionId: z.string().uuid(), outcome: MockCheckoutOutcomeSchema })
  .strict();

export const CheckoutSessionQuerySchema = z.object({ session: z.string().uuid() });

export const CheckoutSessionParamsSchema = z.object({ id: z.string().uuid() });

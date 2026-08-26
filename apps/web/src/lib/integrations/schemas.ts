import { z } from "zod";

export const IntegrationAppSlugSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/);
export const IntegrationRefSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const BotIntegrationParamsSchema = z.object({
  id: z.string().uuid(),
  ref: IntegrationRefSchema,
});

export const ConnectParamsSchema = z.object({
  id: z.string().uuid(),
  ref: IntegrationAppSlugSchema,
});

export const ConnectedQuerySchema = IntegrationAppSlugSchema.optional();

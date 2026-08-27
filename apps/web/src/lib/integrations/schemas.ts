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

export const CATALOG_SEARCH_LIMIT = 24;

export const CATALOG_QUERY_MAX_LENGTH = 64;

export const CatalogSearchSchema = z.object({
  q: z.string().trim().max(CATALOG_QUERY_MAX_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(CATALOG_SEARCH_LIMIT),
});
export type CatalogSearch = z.infer<typeof CatalogSearchSchema>;

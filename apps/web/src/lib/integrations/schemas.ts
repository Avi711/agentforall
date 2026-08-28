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

// Mirrors CATALOG_MAX_SLUGS in the orchestrator: more slugs than this and the lookup is rejected.
export const CATALOG_SLUGS_LIMIT = 50;

export const CATALOG_QUERY_MAX_LENGTH = 64;

export const CATALOG_MAX_OFFSET = 10_000;

export const CatalogSearchSchema = z.object({
  q: z.string().trim().max(CATALOG_QUERY_MAX_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(CATALOG_SEARCH_LIMIT),
  offset: z.coerce.number().int().min(0).max(CATALOG_MAX_OFFSET).default(0),
});
export type CatalogSearch = z.infer<typeof CatalogSearchSchema>;

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

// Mirror the orchestrator, which enforces them: here they only let the form answer before a round trip.
export const INTEGRATION_MAX_ACCOUNTS_PER_APP = 3;
export const ACCOUNT_LABEL_MAX_LENGTH = 40;

// Mirrors the orchestrator's normalizeLabel: invisible format marks go, except ZWNJ/ZWJ (emoji need them).
const INVISIBLE_FORMAT = /(?![\u200C\u200D])\p{Cf}/gu;

export function normalizeAccountLabel(value: string): string {
  return value.replace(INVISIBLE_FORMAT, "").normalize("NFC").trim();
}

export function accountLabelKey(value: string | null): string {
  return normalizeAccountLabel(value ?? "").toLowerCase();
}

export const AccountLabelSchema = z
  .string()
  .transform(normalizeAccountLabel)
  .pipe(z.string().min(1).max(ACCOUNT_LABEL_MAX_LENGTH).regex(/^[^\p{Cc}]+$/u));

// Optional as a whole: the first account of an app is connected without a name.
export const ConnectBodySchema = z.object({ label: AccountLabelSchema.optional() }).strict().optional();
export const RenameBodySchema = z.object({ label: AccountLabelSchema }).strict();

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

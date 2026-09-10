import { INTEGRATION_PROVIDERS } from "@agent-forall/db";
export { INTEGRATION_PROVIDERS };
export type IntegrationProviderName = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_CONNECTION_STATUSES = [
  "active",
  "pending",
  "expired",
  "failed",
  "inactive",
] as const;
export type IntegrationConnectionStatus = (typeof INTEGRATION_CONNECTION_STATUSES)[number];

export interface CatalogApp {
  slug: string;
  name: string;
  logo: string | null;
  description: string | null;
  categories: string[];
  noAuth: boolean;
}

export const CATALOG_MAX_LIMIT = 100;
export const CATALOG_MAX_SLUGS = 50;
// The catalog is a few thousand apps; anything past this is a client bug, not a page.
export const CATALOG_MAX_OFFSET = 10_000;

export interface CatalogQuery {
  q?: string;
  slugs?: string[];
  limit: number;
  offset: number;
}

// `total` is what the query matched, not what this page holds: the browser paginates against it.
export interface CatalogPage {
  apps: CatalogApp[];
  total: number;
}

export const INTEGRATION_MAX_ACCOUNTS_PER_APP = 3;
export const INTEGRATION_LABEL_MAX_LENGTH = 40;

export interface IntegrationConnection {
  ref: string;
  app: string;
  status: IntegrationConnectionStatus;
  label: string | null;
  createdAt: string | null;
}

export interface IntegrationConnectRequest {
  app: string;
  returnUrl: string;
  label?: string;
}

// Invisible marks (Hebrew keyboards add them unasked) make names look alike; emoji need ZWNJ/ZWJ, so those stay.
const INVISIBLE_FORMAT = /(?![\u200C\u200D])\p{Cf}/gu;

export function normalizeLabel(label: string): string {
  return label.replace(INVISIBLE_FORMAT, "").normalize("NFC").trim();
}

// Two names are the same account name when a person would read them as one.
export function labelKey(label: string | null | undefined): string {
  return normalizeLabel(label ?? "").toLowerCase();
}

export interface IntegrationSession {
  instanceId: string;
  provider: IntegrationProviderName;
  providerSessionId: string;
  upstreamMcpUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export const INTEGRATION_APP_SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const INTEGRATION_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

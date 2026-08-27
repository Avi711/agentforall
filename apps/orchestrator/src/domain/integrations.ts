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

export interface CatalogQuery {
  q?: string;
  slugs?: string[];
  limit: number;
}

export interface IntegrationConnection {
  ref: string;
  app: string;
  status: IntegrationConnectionStatus;
  createdAt: string | null;
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

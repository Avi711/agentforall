import { z } from "zod";
import { readAppUrl, type Env } from "../../config";
import { BillingUnavailableError } from "../../errors";
import { PLAN_CODES, type PlanCode } from "../../pricing";

const PADDLE_ENVIRONMENTS = ["sandbox", "production"] as const;
export type PaddleEnvironment = (typeof PADDLE_ENVIRONMENTS)[number];

export interface PaddleConfig {
  environment: PaddleEnvironment;
  apiKey: string;
  webhookSecret: string;
  priceIds: ReadonlyMap<PlanCode, string>;
  topupProductId: string;
  clientToken: string;
  appUrl: string;
}

// What the browser needs to open a checkout; the client token is public by design.
export interface PaddleClientConfig {
  environment: PaddleEnvironment;
  clientToken: string;
}

const PriceIdsSchema = z.record(z.string(), z.string().regex(/^pri_[a-z0-9]+$/));

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new BillingUnavailableError(`missing env: ${name}`);
  return value;
}

function readEnvironment(env: Env): PaddleEnvironment {
  const value = required(env, "PADDLE_ENVIRONMENT");
  const parsed = z.enum(PADDLE_ENVIRONMENTS).safeParse(value);
  if (!parsed.success) throw new BillingUnavailableError(`PADDLE_ENVIRONMENT must be one of ${PADDLE_ENVIRONMENTS.join(", ")}`);
  return parsed.data;
}

function readPriceIds(raw: string): ReadonlyMap<PlanCode, string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BillingUnavailableError("PADDLE_PRICE_IDS is not JSON");
  }
  const parsed = PriceIdsSchema.safeParse(json);
  if (!parsed.success) throw new BillingUnavailableError("PADDLE_PRICE_IDS must map plan codes to pri_ ids");
  const ids = new Map<PlanCode, string>();
  const missing: PlanCode[] = [];
  for (const code of PLAN_CODES) {
    const id = parsed.data[code];
    if (id) ids.set(code, id);
    else missing.push(code);
  }
  if (missing.length > 0) throw new BillingUnavailableError(`PADDLE_PRICE_IDS is missing: ${missing.join(", ")}`);
  return ids;
}

export function readPaddleConnection(env: Env): Pick<PaddleConfig, "environment" | "apiKey"> {
  return { environment: readEnvironment(env), apiKey: required(env, "PADDLE_API_KEY") };
}

export function readPaddleConfig(env: Env): PaddleConfig {
  return {
    ...readPaddleConnection(env),
    webhookSecret: required(env, "PADDLE_WEBHOOK_SECRET"),
    priceIds: readPriceIds(required(env, "PADDLE_PRICE_IDS")),
    topupProductId: required(env, "PADDLE_TOPUP_PRODUCT_ID"),
    clientToken: required(env, "PADDLE_CLIENT_TOKEN"),
    appUrl: readAppUrl(env),
  };
}

export function readPaddleClientConfig(env: Env): PaddleClientConfig {
  return { environment: readEnvironment(env), clientToken: required(env, "PADDLE_CLIENT_TOKEN") };
}

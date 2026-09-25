import { z } from "zod";
import { fetchWithRetry } from "../../../http/fetch-with-retry";
import { PaymentProviderError } from "../../errors";
import type { PaddleEnvironment } from "./config";
import {
  CHECKOUT_SESSION_KEY,
  PaddleErrorSchema,
  PaddlePortalSessionSchema,
  PaddleSubscriptionSchema,
  PaddleTransactionSchema,
  SINGLE_UNIT,
  type PaddleSubscription,
  type PaddleTransaction,
} from "./wire";

const API_BASE: Record<PaddleEnvironment, string> = {
  sandbox: "https://sandbox-api.paddle.com",
  production: "https://api.paddle.com",
};

const TIMEOUT_MS = 10_000;
const BACKOFF_MS = 300;
const IDEMPOTENT_ATTEMPTS = 3;

const ResponseEnvelopeSchema = z.object({ data: z.unknown() });

export interface PaddleConnection {
  environment: PaddleEnvironment;
  apiKey: string;
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PATCH";

// Only idempotent calls retry; a retried create could charge or open twice.
export async function paddleRequest<T>(
  connection: PaddleConnection,
  method: Method,
  path: string,
  schema: z.ZodType<T>,
  options: { body?: unknown; idempotent: boolean },
): Promise<T> {
  const operation = `${method} ${path.split("?")[0]}`;
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${API_BASE[connection.environment]}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          "Content-Type": "application/json",
          "Paddle-Version": "1",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { attempts: options.idempotent ? IDEMPOTENT_ATTEMPTS : 1, timeoutMs: TIMEOUT_MS, backoffMs: BACKOFF_MS, fetch: connection.fetch },
    );
  } catch (err) {
    throw new PaymentProviderError("paddle", `${operation}: ${err instanceof Error ? err.name : "network error"}`, null, true);
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = PaddleErrorSchema.safeParse(json);
    const code = error.success ? error.data.error.code : `HTTP ${res.status}`;
    throw new PaymentProviderError("paddle", `${operation}: ${code}`, res.status, res.status === 429 || res.status >= 500);
  }
  const envelope = ResponseEnvelopeSchema.safeParse(json);
  const parsed = envelope.success ? schema.safeParse(envelope.data.data) : null;
  if (!parsed?.success) throw new PaymentProviderError("paddle", `${operation}: unexpected response shape`, res.status, false);
  return parsed.data;
}

export type PaddleTransactionItem =
  | { price_id: string; quantity: 1 }
  | {
      quantity: 1;
      price: {
        name: string;
        description: string;
        product_id: string;
        unit_price: { amount: string; currency_code: string };
        tax_mode: "internal";
        quantity: typeof SINGLE_UNIT;
      };
    };

export class PaddleApi {
  constructor(private readonly connection: PaddleConnection) {}

  createTransaction(input: { item: PaddleTransactionItem; currencyCode: string; checkoutSessionId: string }): Promise<PaddleTransaction> {
    return paddleRequest(this.connection, "POST", "/transactions", PaddleTransactionSchema, {
      idempotent: false,
      body: {
        items: [input.item],
        currency_code: input.currencyCode,
        custom_data: { [CHECKOUT_SESSION_KEY]: input.checkoutSessionId },
      },
    });
  }

  getSubscription(id: string): Promise<PaddleSubscription> {
    return paddleRequest(this.connection, "GET", `/subscriptions/${encodeURIComponent(id)}`, PaddleSubscriptionSchema, { idempotent: true });
  }

  cancelAtPeriodEnd(id: string): Promise<PaddleSubscription> {
    return paddleRequest(this.connection, "POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, PaddleSubscriptionSchema, {
      idempotent: true,
      body: { effective_from: "next_billing_period" },
    });
  }

  removeScheduledChange(id: string): Promise<PaddleSubscription> {
    return paddleRequest(this.connection, "PATCH", `/subscriptions/${encodeURIComponent(id)}`, PaddleSubscriptionSchema, {
      idempotent: true,
      body: { scheduled_change: null },
    });
  }

  async createPortalUrl(customerId: string, subscriptionId: string): Promise<string> {
    const session = await paddleRequest(
      this.connection,
      "POST",
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      PaddlePortalSessionSchema,
      { idempotent: true, body: { subscription_ids: [subscriptionId] } },
    );
    return session.urls.general.overview;
  }

  getPaymentMethodUpdateTransaction(subscriptionId: string): Promise<PaddleTransaction> {
    return paddleRequest(
      this.connection,
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}/update-payment-method-transaction`,
      PaddleTransactionSchema,
      { idempotent: true },
    );
  }
}

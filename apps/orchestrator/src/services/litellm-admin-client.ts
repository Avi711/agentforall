import { z } from "zod";

export interface LiteLlmKeyRequest {
  instanceId: string;
  userId: string;
  keyAlias: string;
  models: string[];
  maxBudgetCents: number;
  budgetDuration: string;
}

export interface LiteLlmKey {
  key: string;
  keyAlias: string;
  keyHash: string | null;
}

export interface LiteLlmKeyUsage {
  spendCents: number;
  maxBudgetCents: number | null;
  budgetDuration: string | null;
  budgetResetAt: string | null;
  keyAlias: string | null;
  models: string[];
}

const GenerateKeyResponse = z
  .object({
    key: z.string().min(1),
    key_alias: z.string().optional(),
    key_name: z.string().optional(),
    token: z.string().optional(),
  })
  .passthrough();

const KeyInfoResponse = z
  .object({
    info: z
      .object({
        spend: z.number().optional().nullable(),
        max_budget: z.number().optional().nullable(),
        budget_duration: z.string().optional().nullable(),
        budget_reset_at: z.string().optional().nullable(),
        key_alias: z.string().optional().nullable(),
        models: z.array(z.string()).optional().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export class LiteLlmAdminClient {
  constructor(
    private readonly baseUrl: string,
    private readonly masterKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateKey(input: LiteLlmKeyRequest): Promise<LiteLlmKey> {
    const body = {
      key_alias: input.keyAlias,
      models: input.models,
      max_budget: input.maxBudgetCents / 100,
      budget_duration: input.budgetDuration,
      user_id: input.userId,
      metadata: {
        service: "agentforall",
        instance_id: input.instanceId,
        user_id: input.userId,
      },
    };
    const payload = GenerateKeyResponse.parse(
      await this.request("/key/generate", body),
    );
    return {
      key: payload.key,
      keyAlias: payload.key_alias ?? input.keyAlias,
      keyHash: payload.token ?? payload.key_name ?? null,
    };
  }

  async updateKeyBudget(
    key: string,
    maxBudgetCents: number,
    budgetDuration: string,
  ): Promise<void> {
    await this.request("/key/update", {
      key,
      max_budget: maxBudgetCents / 100,
      budget_duration: budgetDuration,
    });
  }

  async deleteKey(key: string): Promise<void> {
    await this.request("/key/delete", { keys: [key] });
  }

  async getKeyUsage(key: string): Promise<LiteLlmKeyUsage> {
    const url = new URL("/key/info", this.baseUrl);
    url.searchParams.set("key", key);
    const payload = KeyInfoResponse.parse(await this.requestJson(url, {
      method: "GET",
    }));
    return {
      spendCents: dollarsToCents(payload.info.spend ?? 0),
      maxBudgetCents:
        payload.info.max_budget === null || payload.info.max_budget === undefined
          ? null
          : dollarsToCents(payload.info.max_budget),
      budgetDuration: payload.info.budget_duration ?? null,
      budgetResetAt: payload.info.budget_reset_at ?? null,
      keyAlias: payload.info.key_alias ?? null,
      models: payload.info.models ?? [],
    };
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async requestJson(
    url: URL,
    init: RequestInit,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.masterKey}`);
    const response = await this.fetchImpl(url, {
      ...init,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`LiteLLM admin request failed: ${response.status}`);
    }
    return text ? JSON.parse(text) : {};
  }
}

function dollarsToCents(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

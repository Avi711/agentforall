import type { AppConfig } from "../config.js";
import type { BotUsage, Instance, ProviderConfig } from "../domain/types.js";
import {
  LiteLlmAdminClient,
  type LiteLlmKeyUsage,
} from "./litellm-admin-client.js";

export interface LiteLlmProvisionResult {
  provider: ProviderConfig;
  keyAlias: string;
  keyHash: string | null;
  budgetCents: number;
  budgetDuration: string;
}

export interface LlmKeyProvisioner {
  provisionProvider(
    instanceId: string,
    userId: string,
    displayName: string,
  ): Promise<LiteLlmProvisionResult>;
  updateBudget(inst: Instance, budgetCents: number): Promise<void>;
  getUsage(inst: Instance): Promise<LiteLlmKeyUsage>;
  getBotUsage(inst: Instance): Promise<BotUsage>;
  revoke(inst: Instance): Promise<void>;
  revokeKey(key: string): Promise<void>;
}

export class LiteLlmKeyManager implements LlmKeyProvisioner {
  constructor(
    private readonly appConfig: AppConfig,
    private readonly adminClient: LiteLlmAdminClient | null,
  ) {}

  static fromConfig(config: AppConfig): LiteLlmKeyManager {
    const baseUrl = config.defaultProviderBaseUrl;
    const masterKey = config.litellmMasterKey;
    const adminClient =
      config.defaultProviderName === "litellm" && baseUrl && masterKey
        ? new LiteLlmAdminClient(baseUrl, masterKey)
        : null;
    return new LiteLlmKeyManager(config, adminClient);
  }

  async provisionProvider(
    instanceId: string,
    userId: string,
    displayName: string,
  ): Promise<LiteLlmProvisionResult> {
    if (this.appConfig.defaultProviderName !== "litellm") {
      return {
        provider: this.staticDefaultProvider(),
        keyAlias: "",
        keyHash: null,
        budgetCents: 0,
        budgetDuration: "",
      };
    }
    if (!this.appConfig.defaultProviderBaseUrl) {
      throw new Error("LiteLLM default provider requires DEFAULT_PROVIDER_BASE_URL");
    }
    if (!this.adminClient) {
      throw new Error("LiteLLM per-bot keys require LITELLM_MASTER_KEY");
    }

    const keyAlias = this.keyAlias(instanceId, displayName);
    const budgetCents = this.appConfig.litellmDefaultBudgetCents;
    const budgetDuration = this.appConfig.litellmDefaultBudgetDuration;
    const generated = await this.adminClient.generateKey({
      instanceId,
      userId,
      keyAlias,
      models: [this.appConfig.defaultProviderModel],
      maxBudgetCents: budgetCents,
      budgetDuration,
    });

    return {
      provider: {
        name: "litellm",
        id: this.appConfig.defaultProviderId ?? "litellm",
        apiKey: generated.key,
        model: this.appConfig.defaultProviderModel,
        baseUrl: this.appConfig.defaultProviderBaseUrl,
        ...(this.appConfig.defaultProviderInput
          ? { input: this.appConfig.defaultProviderInput }
          : {}),
        ...(this.appConfig.defaultProviderMedia
          ? { media: this.appConfig.defaultProviderMedia }
          : {}),
      },
      keyAlias: generated.keyAlias,
      keyHash: generated.keyHash,
      budgetCents,
      budgetDuration,
    };
  }

  async updateBudget(inst: Instance, budgetCents: number): Promise<void> {
    if (inst.config.provider.name !== "litellm") {
      throw new Error("instance is not using LiteLLM");
    }
    if (!this.adminClient) {
      throw new Error("LiteLLM budget updates require LITELLM_MASTER_KEY");
    }
    await this.adminClient.updateKeyBudget(inst.config.provider.apiKey, budgetCents);
  }

  async getUsage(inst: Instance): Promise<LiteLlmKeyUsage> {
    if (inst.config.provider.name !== "litellm") {
      throw new Error("instance is not using LiteLLM");
    }
    if (!this.adminClient) {
      throw new Error("LiteLLM usage requires LITELLM_MASTER_KEY");
    }
    return this.adminClient.getKeyUsage(inst.config.provider.apiKey);
  }

  // Usage in the web-facing shape; callers decide how a LiteLLM failure is surfaced.
  async getBotUsage(inst: Instance): Promise<BotUsage> {
    if (inst.config.provider.name !== "litellm") {
      return { supported: false, reason: "not_litellm" };
    }
    const usage = await this.getUsage(inst);
    return {
      supported: true,
      spendCents: usage.spendCents,
      maxBudgetCents: usage.maxBudgetCents,
      budgetDuration: usage.budgetDuration,
      budgetResetAt: usage.budgetResetAt,
      keyAlias: usage.keyAlias ?? inst.litellm.keyAlias,
      models: usage.models,
      updatedAt: new Date().toISOString(),
    };
  }

  async revoke(inst: Instance): Promise<void> {
    if (inst.config.provider.name !== "litellm" || !this.adminClient) return;
    await this.adminClient.deleteKey(inst.config.provider.apiKey);
  }

  async revokeKey(key: string): Promise<void> {
    if (!this.adminClient) return;
    await this.adminClient.deleteKey(key);
  }

  private staticDefaultProvider(): ProviderConfig {
    const apiKey = this.appConfig.defaultProviderApiKey;
    if (!apiKey) {
      throw new Error(
        "no provider supplied and DEFAULT_PROVIDER_API_KEY is not configured",
      );
    }
    return {
      name: this.appConfig.defaultProviderName,
      apiKey,
      model: this.appConfig.defaultProviderModel,
      ...(this.appConfig.defaultProviderId
        ? { id: this.appConfig.defaultProviderId }
        : {}),
      ...(this.appConfig.defaultProviderBaseUrl
        ? { baseUrl: this.appConfig.defaultProviderBaseUrl }
        : {}),
      ...(this.appConfig.defaultProviderInput
        ? { input: this.appConfig.defaultProviderInput }
        : {}),
      ...(this.appConfig.defaultProviderMedia
        ? { media: this.appConfig.defaultProviderMedia }
        : {}),
    };
  }

  private keyAlias(instanceId: string, displayName: string): string {
    const cleaned = displayName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `agentforall-${cleaned || "bot"}-${instanceId.slice(0, 8)}`;
  }
}

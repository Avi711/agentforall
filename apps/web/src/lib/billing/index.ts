import "server-only";
import { after } from "next/server";
import { readBillingConfig } from "./config";
import { BillingUnavailableError } from "./errors";
import { OrchestratorLlmBudget } from "./credits/orchestrator-budget";
import { CreditService } from "./credits/service";
import { consoleBillingLogger } from "./logger";
import { createProviderRegistry } from "./provider/registry";
import { MockCheckoutSimulator } from "./providers/mock/simulator";
import { readPaddleClientConfig, type PaddleClientConfig } from "./providers/paddle/config";
import type { BillingUser } from "./domain";
import {
  DrizzleBillingEventRepository,
  DrizzleCheckoutSessionRepository,
  DrizzleCreditGrantRepository,
  DrizzleCreditUsageRepository,
  DrizzlePaymentRepository,
  DrizzleSubscriptionRepository,
  DrizzleTrialClaimRepository,
} from "./repository";
import { BillingService } from "./service";

export interface BotLifecycleHooks {
  beforeBotCreate(owner: BillingUser): Promise<void>;
  afterBotCreated(userId: string): Promise<void>;
  beforeBotDelete(userId: string, botId: string): Promise<void>;
}

// Composition root; billing has too many collaborators for the repo-only constructors smaller domains use.
let cached: BillingService | undefined;

export function getBillingService(): BillingService {
  if (!cached) {
    const config = readBillingConfig(process.env);
    const credits = new CreditService({
      grants: new DrizzleCreditGrantRepository(),
      usage: new DrizzleCreditUsageRepository(),
      llm: new OrchestratorLlmBudget(),
      logger: consoleBillingLogger,
    });
    cached = new BillingService({
      providers: createProviderRegistry(process.env, {}, consoleBillingLogger),
      subscriptions: new DrizzleSubscriptionRepository(),
      checkouts: new DrizzleCheckoutSessionRepository(),
      payments: new DrizzlePaymentRepository(),
      events: new DrizzleBillingEventRepository(),
      trialClaims: new DrizzleTrialClaimRepository(),
      credits,
      enforcement: config.enforcement,
      appUrl: config.appUrl,
      background: (work) => after(work),
      logger: consoleBillingLogger,
    });
  }
  return cached;
}

// Null when Paddle is not configured, so its payment page does not exist.
export function getPaddleClientConfig(): PaddleClientConfig | null {
  try {
    return readPaddleClientConfig(process.env);
  } catch (err) {
    if (err instanceof BillingUnavailableError) return null;
    throw err;
  }
}

export function getBotLifecycleHooks(): BotLifecycleHooks {
  return {
    beforeBotCreate: (owner) => getBillingService().beforeBotCreate(owner),
    afterBotCreated: async (userId) => {
      await getBillingService().afterBotCreated(userId);
    },
    beforeBotDelete: (userId, botId) => getBillingService().beforeBotDelete(userId, botId),
  };
}

export function getMockCheckoutSimulator(): MockCheckoutSimulator {
  return new MockCheckoutSimulator(getBillingService());
}

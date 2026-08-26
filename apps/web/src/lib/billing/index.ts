import "server-only";
import { readBillingConfig } from "./config";
import { OrchestratorLlmBudget } from "./credits/orchestrator-budget";
import { CreditService } from "./credits/service";
import { consoleBillingLogger } from "./logger";
import { createProviderRegistry } from "./provider/registry";
import { MockCheckoutSimulator } from "./providers/mock/simulator";
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
      logger: consoleBillingLogger,
    });
  }
  return cached;
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

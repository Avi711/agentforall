import "server-only";
import { getOrchestratorClient, type OrchestratorClient } from "../../orchestrator/client";
import type { Instance } from "../../orchestrator/types";
import type { BotSpend, LlmBudgetPort } from "../ports";

// Bots whose gateway key is gone or being revoked; an `error` bot's key was revoked by the failed destroy.
const GONE_STATUSES: ReadonlySet<Instance["status"]> = new Set(["destroying", "destroyed", "error"]);

type BudgetClient = Pick<OrchestratorClient, "listBots" | "getBotUsage" | "updateBotBudget">;

export class OrchestratorLlmBudget implements LlmBudgetPort {
  constructor(private readonly client: BudgetClient = getOrchestratorClient()) {}

  async listLiveBotIds(userId: string): Promise<string[]> {
    const bots = await this.client.listBots(userId);
    return bots.filter((bot) => !GONE_STATUSES.has(bot.status)).map((bot) => bot.id);
  }

  async readSpend(userId: string, botId: string): Promise<BotSpend> {
    const usage = await this.client.getBotUsage(userId, botId);
    if (!usage.supported) return { botId, supported: false, spendUsdCents: 0, maxBudgetUsdCents: null };
    return { botId, supported: true, spendUsdCents: usage.spendCents, maxBudgetUsdCents: usage.maxBudgetCents };
  }

  async setCeiling(userId: string, botId: string, maxBudgetUsdCents: number): Promise<void> {
    await this.client.updateBotBudget(userId, botId, maxBudgetUsdCents);
  }
}

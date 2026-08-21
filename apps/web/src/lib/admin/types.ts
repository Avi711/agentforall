import type { BotSnapshot } from "../bots/snapshot";
import type { BotUsage } from "../orchestrator/types";

export interface AdminBot {
  snapshot: BotSnapshot;
  runtimeKind: string;
  model: string | null;
  errorMessage: string | null;
  createdAt: string;
  // null = usage lookup failed for this bot.
  usage: BotUsage | null;
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  lastActiveAt: string | null;
  betaAccess: boolean;
  bots: AdminBot[];
  // Current LiteLLM budget period, summed over the user's bots.
  spendCents: number;
  maxBudgetCents: number | null;
}

export interface AdminOverview {
  users: AdminUser[];
  totals: {
    users: number;
    // Every non-destroyed bot, including errored ones.
    bots: number;
    liveBots: number;
    erroredBots: number;
    connectedBots: number;
    spendCents: number;
    usageUnavailable: number;
  };
  generatedAt: string;
}

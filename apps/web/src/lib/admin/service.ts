import "server-only";
import { getOrchestratorClient, type OrchestratorClient } from "../orchestrator/client";
import type { AdminInstance, BotUsage } from "../orchestrator/types";
import { toBotSnapshot } from "../bots/snapshot";
import { AdminRepository } from "./repository";
import type { AdminBot, AdminOverview, AdminUser } from "./types";

export class AdminService {
  constructor(
    private readonly repo: AdminRepository = new AdminRepository(),
    private readonly orchestrator: Pick<OrchestratorClient, "listAdminInstances"> = getOrchestratorClient(),
  ) {}

  async overview(): Promise<AdminOverview> {
    const [rows, instances] = await Promise.all([
      this.repo.listUsers(),
      this.orchestrator.listAdminInstances(),
    ]);
    const botsByUser = groupBots(instances);

    const users: AdminUser[] = rows.map((row) => {
      const bots = botsByUser.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
        lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
        betaAccess: row.betaAccess,
        bots,
        spendCents: sumSpend(bots),
        maxBudgetCents: sumBudget(bots),
      };
    });

    const allBots = users.flatMap((u) => u.bots);
    return {
      users,
      totals: {
        users: users.length,
        bots: allBots.length,
        connectedBots: allBots.filter(isConnected).length,
        spendCents: sumSpend(allBots),
        usageUnavailable: allBots.filter((b) => b.usage === null).length,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

function groupBots(instances: AdminInstance[]): Map<string, AdminBot[]> {
  const map = new Map<string, AdminBot[]>();
  for (const row of instances) {
    const bot: AdminBot = {
      snapshot: toBotSnapshot(row.instance),
      createdAt: row.instance.createdAt,
      usage: row.usage,
    };
    const list = map.get(row.instance.userId);
    if (list) list.push(bot);
    else map.set(row.instance.userId, [bot]);
  }
  return map;
}

function supportedUsage(bot: AdminBot): Extract<BotUsage, { supported: true }> | null {
  return bot.usage?.supported ? bot.usage : null;
}

function sumSpend(bots: AdminBot[]): number {
  return bots.reduce((sum, bot) => sum + (supportedUsage(bot)?.spendCents ?? 0), 0);
}

// null when no bot carries a budget at all.
function sumBudget(bots: AdminBot[]): number | null {
  const budgets = bots
    .map((bot) => supportedUsage(bot)?.maxBudgetCents ?? null)
    .filter((value): value is number => value !== null);
  return budgets.length > 0 ? budgets.reduce((a, b) => a + b, 0) : null;
}

function isConnected(bot: AdminBot): boolean {
  const s = bot.snapshot;
  return (s.pairingStatus === "paired" && s.hasWhatsappCreds) || Boolean(s.telegram?.linked);
}

export const adminService = new AdminService();

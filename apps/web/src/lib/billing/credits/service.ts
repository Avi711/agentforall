import { DAY_MS } from "../dates";
import type { CreditGrant, CreditGrantKind, CreditUsageCursor } from "../domain";
import { errorMessage, type BillingLogger } from "../logger";
import type { BotSpend, CreditGrantRepository, CreditUsageRepository, LlmBudgetPort } from "../ports";
import { LOW_BALANCE_RATIO, TRIAL_CREDITS, TRIAL_DAYS, creditsFromUsdCents, usdCentsFromCredits } from "../pricing";
import { attributeConsumption, availableCredits, currentAllowance, isGrantLive, remainingCredits } from "./allocation";

const MAX_ADVANCE_ATTEMPTS = 3;
const SYNC_ALL_CONCURRENCY = 4;

// Ledger view: `available` only says no grant exists yet; BillingService also checks the trial claim.
export type TrialState =
  | { kind: "available" }
  | { kind: "active"; expiresAt: string; remainingCredits: number }
  | { kind: "used" };

export interface CreditGrantView {
  id: string;
  kind: CreditGrantKind;
  credits: number;
  usedCredits: number;
  expiresAt: string | null;
  live: boolean;
}

export interface CreditSummary {
  available: number;
  allowance: number;
  consumed: number;
  unallocated: number;
  lowBalance: boolean;
  trial: TrialState;
  grants: CreditGrantView[];
  syncedAt: string | null;
  // True when the last refresh could not reach the gateway for at least one bot.
  stale: boolean;
}

export interface SyncAllResult {
  users: number;
  failures: string[];
}

export interface CreditServiceDeps {
  grants: CreditGrantRepository;
  usage: CreditUsageRepository;
  llm: LlmBudgetPort;
  now?: () => Date;
  logger: BillingLogger;
}

interface BotSyncResult {
  cursor: CreditUsageCursor | null;
  grants: CreditGrant[];
}

export class CreditService {
  private readonly grants: CreditGrantRepository;
  private readonly usage: CreditUsageRepository;
  private readonly llm: LlmBudgetPort;
  private readonly now: () => Date;
  private readonly log: BillingLogger;

  constructor(deps: CreditServiceDeps) {
    this.grants = deps.grants;
    this.usage = deps.usage;
    this.llm = deps.llm;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.logger;
  }

  async trialState(userId: string): Promise<TrialState> {
    return trialStateOf(await this.grants.listByUserId(userId), this.now());
  }

  // Idempotent per user; the caller decides eligibility.
  async startTrial(userId: string): Promise<boolean> {
    const grant = await this.grants.insertIfAbsent({
      userId,
      kind: "trial",
      credits: TRIAL_CREDITS,
      sourceRef: `trial:${userId}`,
      expiresAt: new Date(this.now().getTime() + TRIAL_DAYS * DAY_MS),
    });
    if (grant) this.log.info("trial granted", { userId, credits: TRIAL_CREDITS });
    return grant !== null;
  }

  async grantPlanCredits(userId: string, credits: number, expiresAt: Date, sourceRef: string): Promise<boolean> {
    const grant = await this.grants.insertIfAbsent({ userId, kind: "plan", credits, sourceRef, expiresAt });
    if (grant) this.log.info("plan credits granted", { userId, credits, sourceRef });
    return grant !== null;
  }

  async grantTopup(userId: string, credits: number, sourceRef: string): Promise<boolean> {
    const grant = await this.grants.insertIfAbsent({ userId, kind: "topup", credits, sourceRef, expiresAt: null });
    if (grant) this.log.info("top-up granted", { userId, credits, sourceRef });
    return grant !== null;
  }

  // Ledger-only read for polling: no gateway round-trips.
  async summary(userId: string): Promise<CreditSummary> {
    const [grants, cursors] = await Promise.all([this.grants.listByUserId(userId), this.usage.listByUserId(userId)]);
    return this.summarize(grants, cursors, false);
  }

  // Pulls spend, attributes it to grants, re-caps every live bot; a user with no ledger keeps the gateway defaults.
  async sync(userId: string): Promise<CreditSummary> {
    let grants = await this.grants.listByUserId(userId);
    if (grants.length === 0) return this.summarize(grants, [], false);

    const botIds = await this.llm.listLiveBotIds(userId);
    const cursors: CreditUsageCursor[] = [];
    let stale = false;
    for (const botId of botIds) {
      try {
        const result = await this.syncBot(userId, botId, grants);
        grants = result.grants;
        if (result.cursor) cursors.push(result.cursor);
      } catch (err) {
        stale = true;
        this.log.error("bot credit sync failed", { userId, botId, error: errorMessage(err) });
      }
    }
    return this.summarize(grants, cursors, stale);
  }

  // Charges everything the bot spent before its key disappears; throws so the caller can refuse the deletion.
  async settleBot(userId: string, botId: string): Promise<void> {
    const grants = await this.grants.listByUserId(userId);
    if (grants.length === 0) return;
    const spend = await this.llm.readSpend(userId, botId);
    if (!spend.supported) return;
    await this.advanceCursor(userId, botId, spend, grants);
    this.log.info("bot settled before deletion", { userId, botId, spendUsdCents: spend.spendUsdCents });
  }

  async syncAll(): Promise<SyncAllResult> {
    const userIds = await this.grants.listUserIdsWithGrants();
    const failures: string[] = [];
    await forEachWithConcurrency(userIds, SYNC_ALL_CONCURRENCY, async (userId) => {
      try {
        const summary = await this.sync(userId);
        if (summary.stale) failures.push(userId);
      } catch (err) {
        failures.push(userId);
        this.log.error("credit sync failed", { userId, error: errorMessage(err) });
      }
    });
    return { users: userIds.length, failures };
  }

  private async syncBot(userId: string, botId: string, grants: CreditGrant[]): Promise<BotSyncResult> {
    const spend = await this.llm.readSpend(userId, botId);
    if (!spend.supported) return { cursor: null, grants };

    const advanced = await this.advanceCursor(userId, botId, spend, grants);
    const now = this.now();
    const ceiling = spend.spendUsdCents + usdCentsFromCredits(availableCredits(advanced.grants, now));
    if (spend.maxBudgetUsdCents !== ceiling) {
      await this.llm.setCeiling(userId, botId, ceiling);
      this.log.info("ceiling updated", { userId, botId, ceilingUsdCents: ceiling });
    }
    return advanced;
  }

  // Each attempt re-reads grants because a lost race means another sync attributed against them.
  private async advanceCursor(userId: string, botId: string, spend: BotSpend, grants: CreditGrant[]): Promise<BotSyncResult> {
    let current = await this.usage.findByBotId(botId);
    for (let attempt = 1; attempt <= MAX_ADVANCE_ATTEMPTS; attempt++) {
      const delta = consumptionDelta(current, spend);
      if (current && delta === 0) return { cursor: current, grants: await this.grants.listByUserId(userId) };

      const now = this.now();
      const attribution = attributeConsumption(grants, delta, current?.syncedAt ?? now);
      const advanced = await this.usage.advance({
        botId,
        userId,
        expectedVersion: current?.version ?? 0,
        spendUsdCents: spend.spendUsdCents,
        consumedDelta: delta,
        unallocatedDelta: attribution.unallocated,
        attributions: attribution.attributions,
        syncedAt: now,
      });
      if (advanced) {
        if (attribution.unallocated > 0) {
          this.log.warn("spend exceeded granted credits", { userId, botId, unallocated: attribution.unallocated });
        }
        return { cursor: await this.usage.findByBotId(botId), grants: await this.grants.listByUserId(userId) };
      }
      current = await this.usage.findByBotId(botId);
      grants = await this.grants.listByUserId(userId);
    }
    throw new Error(`credit sync for bot ${botId} lost the race ${MAX_ADVANCE_ATTEMPTS} times`);
  }

  private summarize(grants: CreditGrant[], cursors: CreditUsageCursor[], stale: boolean): CreditSummary {
    const now = this.now();
    const available = availableCredits(grants, now);
    const allowance = currentAllowance(grants, now);
    const syncedAt = cursors.reduce<Date | null>(
      (latest, c) => (latest === null || c.syncedAt.getTime() > latest.getTime() ? c.syncedAt : latest),
      null,
    );
    return {
      available,
      allowance,
      consumed: cursors.reduce((sum, c) => sum + c.consumedCredits, 0),
      unallocated: cursors.reduce((sum, c) => sum + c.unallocatedCredits, 0),
      lowBalance: allowance > 0 && available <= allowance * LOW_BALANCE_RATIO,
      trial: trialStateOf(grants, now),
      grants: grants.map((g) => ({
        id: g.id,
        kind: g.kind,
        credits: g.credits,
        usedCredits: g.usedCredits,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        live: isGrantLive(g, now),
      })),
      syncedAt: syncedAt?.toISOString() ?? null,
      stale,
    };
  }
}

// The gateway counter only ever grows unless it was reset or the key re-issued, which both start at zero.
function consumptionDelta(cursor: CreditUsageCursor | null, spend: BotSpend): number {
  if (!cursor) return creditsFromUsdCents(spend.spendUsdCents);
  const restarted = spend.spendUsdCents < cursor.lastSpendUsdCents;
  return creditsFromUsdCents(restarted ? spend.spendUsdCents : spend.spendUsdCents - cursor.lastSpendUsdCents);
}

function trialStateOf(grants: readonly CreditGrant[], now: Date): TrialState {
  if (grants.length === 0) return { kind: "available" };
  const trial = grants.find((g) => g.kind === "trial");
  if (trial && trial.expiresAt && isGrantLive(trial, now)) {
    return { kind: "active", expiresAt: trial.expiresAt.toISOString(), remainingCredits: remainingCredits(trial) };
  }
  return { kind: "used" };
}

async function forEachWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  });
  await Promise.all(workers);
}

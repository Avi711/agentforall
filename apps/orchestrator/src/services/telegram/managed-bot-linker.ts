import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { ChannelConfig } from "../../domain/types.js";
import {
  InvalidStateError,
  NotFoundError,
  UpstreamUnavailableError,
} from "../../domain/errors.js";
import type { EventRepository } from "../../storage/event-repository.js";
import type { InstanceManager } from "../instance-manager.js";
import { TelegramApiError, TelegramBotApi, type ManagedBotUpdated } from "./bot-api.js";

export interface TelegramLink {
  deepLink: string;
  botUsername: string;
  expiresAt: string;
}

export interface TelegramLinkStatus {
  status: "none" | "pending" | "connected";
  botUsername: string | null;
  deepLink: string | null;
}

interface PendingLink {
  instanceId: string;
  userId: string;
  suggestedUsername: string;
  deepLink: string;
  expiresAt: number;
}

const LINK_TTL_MS = 60 * 60 * 1000;
const POLL_TIMEOUT_SECONDS = 50;
const POLL_ERROR_BACKOFF_MS = 5_000;
const POLL_CONFLICT_BACKOFF_MS = 60_000;
const PROVISIONING_RETRY_INTERVAL_MS = 10_000;
const PROVISIONING_MAX_ATTEMPTS = 90;
const TRANSIENT_MAX_ATTEMPTS = 4;
const TRANSIENT_BACKOFF_BASE_MS = 1_000;
const WELCOME_MAX_ATTEMPTS = 8;
const WELCOME_RETRY_INTERVAL_MS = 15_000;

// Matches Telegram's managed_bot updates back to instances via the random suggested username.
export class ManagedBotLinker {
  private readonly pendingByUsername = new Map<string, PendingLink>();
  private readonly pendingByInstance = new Map<string, PendingLink>();
  private managerUsername: string | null = null;
  private running = false;

  constructor(
    private readonly api: TelegramBotApi,
    private readonly manager: InstanceManager,
    private readonly eventLog: EventRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
  }

  async createLink(instanceId: string, userId: string): Promise<TelegramLink> {
    const inst = await this.manager.get(instanceId, userId);
    this.sweepExpired();

    // Idempotent: concurrent requests (double-mounted effects, two tabs) share one link.
    const existing = this.pendingByInstance.get(instanceId);
    if (existing) return toTelegramLink(existing);

    const managerUsername = await this.requireManagerUsername();
    const suggestedUsername = `agentforall_${randomBytes(4).toString("hex")}_bot`;
    // Telegram caps bot display names at 64 chars.
    const name = encodeURIComponent(inst.config.displayName.slice(0, 64));
    const link: PendingLink = {
      instanceId,
      userId,
      suggestedUsername,
      deepLink: `https://t.me/newbot/${managerUsername}/${suggestedUsername}?name=${name}`,
      expiresAt: Date.now() + LINK_TTL_MS,
    };
    this.pendingByUsername.set(suggestedUsername, link);
    this.pendingByInstance.set(instanceId, link);
    await this.eventLog.append(instanceId, "telegram.link_requested", {
      actor: userId,
      payload: { suggestedUsername },
    });

    return toTelegramLink(link);
  }

  async getStatus(instanceId: string, userId: string): Promise<TelegramLinkStatus> {
    const inst = await this.manager.get(instanceId, userId);
    const telegram = inst.config.channels.find(
      (ch): ch is Extract<ChannelConfig, { type: "telegram" }> =>
        ch.type === "telegram",
    );
    if (telegram?.botToken) {
      return {
        status: "connected",
        botUsername: telegram.botUsername ?? null,
        deepLink: null,
      };
    }

    this.sweepExpired();
    const pending = this.pendingByInstance.get(instanceId);
    if (pending) {
      return {
        status: "pending",
        botUsername: pending.suggestedUsername,
        deepLink: pending.deepLink,
      };
    }

    return { status: "none", botUsername: null, deepLink: null };
  }

  // Memoized; the orchestrator must boot even when Telegram is unreachable.
  private async requireManagerUsername(): Promise<string> {
    if (this.managerUsername) return this.managerUsername;
    try {
      const me = await this.api.getMe();
      if (!me.username) throw new Error("manager bot has no username");
      this.managerUsername = me.username;
      return me.username;
    } catch (err) {
      this.logger.error({ err }, "telegram manager bot getMe failed");
      throw new UpstreamUnavailableError("Telegram");
    }
  }

  private async pollLoop(): Promise<void> {
    let offset = 0;
    while (this.running) {
      try {
        await this.requireManagerUsername();
        const updates = await this.api.getUpdates(offset, POLL_TIMEOUT_SECONDS);
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.managed_bot) {
            // Detached: attaching can wait minutes for provisioning; the poller must keep going.
            void this.handleManagedBot(update.managed_bot);
          }
        }
      } catch (err) {
        if (!this.running) return;
        const conflict =
          err instanceof TelegramApiError && err.errorCode === 409;
        if (conflict) {
          this.logger.error(
            { err },
            "another process is polling the telegram manager bot",
          );
        } else {
          this.logger.warn({ err }, "telegram manager poll failed");
        }
        await sleep(conflict ? POLL_CONFLICT_BACKOFF_MS : POLL_ERROR_BACKOFF_MS);
      }
    }
  }

  private async handleManagedBot(update: ManagedBotUpdated): Promise<void> {
    const username = update.bot.username?.toLowerCase();
    this.sweepExpired();
    const pending = username ? this.pendingByUsername.get(username) : undefined;
    if (!pending) {
      this.logger.warn(
        { botUsername: update.bot.username },
        "managed bot update without a matching pending link",
      );
      void this.disableOrphan(update.bot.id);
      return;
    }

    try {
      const botToken = await this.withTransientRetry(() =>
        this.api.getManagedBotToken(update.bot.id),
      );
      await this.restrictToOwner(update.bot.id);
      const displayName = await this.attachChannel(pending, update, botToken);
      this.removePending(pending);
      this.logger.info(
        { instanceId: pending.instanceId, botUsername: update.bot.username },
        "telegram bot linked",
      );
      void this.sendWelcome(botToken, update.user.id, displayName, pending.instanceId);
    } catch (err) {
      // Drop the pending link so the status endpoint reports "none" and the UI offers a retry.
      this.removePending(pending);
      void this.disableOrphan(update.bot.id);
      this.logger.error(
        { instanceId: pending.instanceId, err },
        "telegram bot link failed",
      );
      await this.eventLog.append(pending.instanceId, "telegram.link_failed", {
        payload: { botUsername: update.bot.username, error: message(err) },
      });
    }
  }

  // A managed bot we can't (or could no longer) attach must not stay reachable
  // with a live token: lock it to its owner and revoke the token. Best-effort.
  private async disableOrphan(botUserId: number): Promise<void> {
    try {
      await this.api.setManagedBotAccessSettings(botUserId, true);
      await this.api.replaceManagedBotToken(botUserId);
    } catch (err) {
      this.logger.warn({ botUserId, err }, "orphaned managed bot cleanup failed");
    }
  }

  // Telegram-side guard on top of the allowlist; the owner always has access.
  private async restrictToOwner(botUserId: number): Promise<void> {
    try {
      await this.withTransientRetry(() =>
        this.api.setManagedBotAccessSettings(botUserId, true),
      );
    } catch (err) {
      this.logger.warn({ botUserId, err }, "restricting managed bot failed");
    }
  }

  // The user can only receive the welcome after pressing Start, which usually
  // happens seconds after creation — so retry 403s for a while, best-effort.
  private async sendWelcome(
    botToken: string,
    creatorId: number,
    displayName: string,
    instanceId: string,
  ): Promise<void> {
    const botApi = new TelegramBotApi(botToken);
    const text = `✅ ${displayName} מחובר ועולה ממש ברגעים אלה. כתבו לו היי או שלום כדי להתחיל את השיחה — התשובה הראשונה עשויה לקחת דקה־שתיים, ומשם הוא עונה מיד.`;
    for (let attempt = 1; attempt <= WELCOME_MAX_ATTEMPTS; attempt++) {
      try {
        await botApi.sendMessage(creatorId, text);
        return;
      } catch (err) {
        if (attempt === WELCOME_MAX_ATTEMPTS) {
          this.logger.warn({ instanceId, err }, "telegram welcome message failed");
          return;
        }
        await sleep(WELCOME_RETRY_INTERVAL_MS);
      }
    }
  }

  // Waits out "provisioning" (config updates are rejected then); retries transient failures.
  private async attachChannel(
    pending: PendingLink,
    update: ManagedBotUpdated,
    botToken: string,
  ): Promise<string> {
    let provisioningWaits = 0;
    let failures = 0;
    for (;;) {
      try {
        return await this.attachChannelOnce(pending, update, botToken);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (err instanceof InvalidStateError) {
          if (++provisioningWaits > PROVISIONING_MAX_ATTEMPTS) throw err;
          await sleep(PROVISIONING_RETRY_INTERVAL_MS);
        } else {
          if (++failures >= TRANSIENT_MAX_ATTEMPTS) throw err;
          await sleep(TRANSIENT_BACKOFF_BASE_MS * 2 ** failures);
        }
      }
    }
  }

  private async attachChannelOnce(
    pending: PendingLink,
    update: ManagedBotUpdated,
    botToken: string,
  ): Promise<string> {
    const inst = await this.manager.get(pending.instanceId, pending.userId);
    // Fail fast instead of retrying against an instance that is going away.
    if (inst.status === "destroying" || inst.status === "destroyed") {
      throw new NotFoundError("instance", pending.instanceId);
    }
    const previous = inst.config.channels.find(
      (ch): ch is Extract<ChannelConfig, { type: "telegram" }> =>
        ch.type === "telegram",
    );
    const telegram: ChannelConfig = {
      type: "telegram",
      botToken,
      botUsername: update.bot.username,
      botId: update.bot.id,
      dmPolicy: "allowlist",
      allowFrom: [`tg:${update.user.id}`],
    };
    await this.manager.updateChannels(pending.instanceId, pending.userId, (channels) => [
      ...channels.filter((ch) => ch.type !== "telegram"),
      telegram,
    ]);
    await this.eventLog.append(pending.instanceId, "telegram.linked", {
      actor: pending.userId,
      payload: { botUsername: update.bot.username, creatorId: update.user.id },
    });
    // Re-link replaced an older bot: its token must not stay live.
    if (previous?.botId && previous.botId !== update.bot.id) {
      void this.disableOrphan(previous.botId);
    }
    return inst.config.displayName;
  }

  private async withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= TRANSIENT_MAX_ATTEMPTS || !isTransient(err)) throw err;
        await sleep(TRANSIENT_BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  // Drops a pending deep link so a late managed_bot update can't re-attach after a disconnect.
  cancelLink(instanceId: string): void {
    const pending = this.pendingByInstance.get(instanceId);
    if (pending) this.removePending(pending);
  }

  // Identity-guarded: never delete a newer link created while this one was being processed.
  private removePending(pending: PendingLink): void {
    if (this.pendingByUsername.get(pending.suggestedUsername) === pending) {
      this.pendingByUsername.delete(pending.suggestedUsername);
    }
    if (this.pendingByInstance.get(pending.instanceId) === pending) {
      this.pendingByInstance.delete(pending.instanceId);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [username, link] of this.pendingByUsername) {
      if (link.expiresAt <= now) {
        this.pendingByUsername.delete(username);
        if (this.pendingByInstance.get(link.instanceId) === link) {
          this.pendingByInstance.delete(link.instanceId);
        }
      }
    }
  }
}

function toTelegramLink(link: PendingLink): TelegramLink {
  return {
    deepLink: link.deepLink,
    botUsername: link.suggestedUsername,
    expiresAt: new Date(link.expiresAt).toISOString(),
  };
}

function isTransient(err: unknown): boolean {
  return (
    err instanceof TelegramApiError &&
    (err.errorCode === null || err.errorCode === 429 || err.errorCode >= 500)
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

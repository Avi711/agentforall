import type { FastifyBaseLogger } from "fastify";
import type { InboundMessage } from "../../domain/whatsapp-cloud.js";
import {
  CONVERSATION_RETENTION_MS,
  INBOX_BACKLOG_WARN_MS,
  INBOX_DROP_AFTER_MS,
  INBOX_LEASE_MS,
  INBOX_MAX_BATCH,
  INBOX_RETAIN_ACKED_MS,
  SENDS_RETENTION_MS,
} from "../../domain/whatsapp-cloud.js";
import type { EventRepository } from "../../storage/event-repository.js";
import type { WhatsappCloudRepository } from "../../storage/whatsapp-cloud-repository.js";

type InboxStore = Pick<WhatsappCloudRepository, "leasePending" | "sweep">;
type EventLog = Pick<EventRepository, "append">;

interface Waiter {
  resolve(items: InboundMessage[]): void;
  timer: NodeJS.Timeout;
}

interface Queued {
  items: InboundMessage[];
  leasedAt: number;
}

export interface InboxDispatcherOptions {
  pollIntervalMs: number;
  sweepIntervalMs: number;
}

// Leases rows only for bots asking right now; a NOTIFY wakes a tick for that bot, the interval poll is the fallback.
export class InboxDispatcher {
  private readonly waiters = new Map<string, Waiter>();
  private readonly queued = new Map<string, Queued>();
  private readonly wokenWhileBusy = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;

  constructor(
    private readonly store: InboxStore,
    private readonly eventLog: EventLog,
    private readonly log: FastifyBaseLogger,
    private readonly opts: InboxDispatcherOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    this.stopped = false;
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.tick(), this.opts.pollIntervalMs);
    this.sweepTimer = setInterval(() => void this.sweep(), this.opts.sweepIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.pollTimer = null;
    this.sweepTimer = null;
    this.wokenWhileBusy.clear();
    for (const [instanceId, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
      this.waiters.delete(instanceId);
    }
  }

  // One consumer per bot: a newer poll replaces the older one, which returns empty. After stop nothing waits.
  wait(instanceId: string, waitMs: number): Promise<InboundMessage[]> {
    if (this.stopped) return Promise.resolve([]);
    const ready = this.queued.get(instanceId);
    if (ready) {
      this.queued.delete(instanceId);
      // Past the lease the rows are the database's again; handing them out now would double-deliver.
      if (this.now().getTime() - ready.leasedAt < INBOX_LEASE_MS) return Promise.resolve(ready.items);
    }
    this.cancelWaiter(instanceId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(instanceId);
        resolve([]);
      }, waitMs);
      this.waiters.set(instanceId, { resolve, timer });
    });
  }

  // Called on NOTIFY: only a bot whose plugin is waiting here is worth a query, and only that bot is queried.
  wake(instanceId: string): void {
    if (!this.waiters.has(instanceId)) return;
    if (this.polling) {
      this.wokenWhileBusy.add(instanceId);
      return;
    }
    void this.tick([instanceId]);
  }

  async tick(instanceIds: string[] = [...this.waiters.keys()]): Promise<void> {
    if (this.polling) return;
    const asking = instanceIds.filter((id) => this.waiters.has(id));
    if (asking.length === 0) return;
    this.polling = true;
    // The database's lease clock starts at the query, so the batch is stamped before it, never after.
    const leasedAt = this.now().getTime();
    try {
      const { leased, malformed } = await this.store.leasePending(asking, INBOX_MAX_BATCH, INBOX_LEASE_MS);
      if (malformed > 0) this.log.warn({ malformed }, "whatsapp cloud inbox rows without a message payload dropped");
      for (const [instanceId, items] of groupByInstance(leased)) this.handOut(instanceId, items, leasedAt);
    } catch (err) {
      this.log.warn({ err }, "whatsapp cloud inbox poll failed");
    } finally {
      this.polling = false;
    }
    // A row inserted for one of these bots during the query would otherwise wait for the fallback poll.
    const woken = [...this.wokenWhileBusy];
    this.wokenWhileBusy.clear();
    if (woken.length > 0 && this.pollTimer) await this.tick(woken);
  }

  async sweep(): Promise<void> {
    const now = this.now();
    this.forgetStaleQueued(now.getTime());
    try {
      const result = await this.store.sweep({
        dropBefore: new Date(now.getTime() - INBOX_DROP_AFTER_MS),
        deleteAckedBefore: new Date(now.getTime() - INBOX_RETAIN_ACKED_MS),
        deleteConversationsIdleBefore: new Date(now.getTime() - CONVERSATION_RETENTION_MS),
        deleteSendsBefore: new Date(now.getTime() - SENDS_RETENTION_MS),
        backlogOlderThan: new Date(now.getTime() - INBOX_BACKLOG_WARN_MS),
      });
      for (const row of result.dropped) {
        this.log.warn({ instanceId: row.instanceId, wamid: row.wamid }, "whatsapp cloud inbound dropped");
        await this.eventLog.append(row.instanceId, "whatsapp_cloud.inbound_dropped", {
          payload: { wamid: row.wamid, attempts: row.attempts },
        });
      }
      for (const bot of result.backlog) {
        this.log.warn(
          { instanceId: bot.instanceId, pending: bot.pending, oldestReceivedAt: bot.oldestReceivedAt.toISOString() },
          "whatsapp cloud inbox backlog",
        );
      }
      if (result.releasedNumbers > 0) this.log.warn({ released: result.releasedNumbers }, "whatsapp cloud numbers of destroyed bots released");
    } catch (err) {
      this.log.warn({ err }, "whatsapp cloud inbox sweep failed");
    }
  }

  private handOut(instanceId: string, items: InboundMessage[], leasedAt: number): void {
    const waiter = this.waiters.get(instanceId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(instanceId);
      waiter.resolve(items);
      return;
    }
    // Keeps the older batch's clock: the lease guard in wait() must judge by the oldest rows held.
    const pending = this.queued.get(instanceId);
    this.queued.set(instanceId, {
      items: [...(pending?.items ?? []), ...items],
      leasedAt: Math.min(pending?.leasedAt ?? Number.POSITIVE_INFINITY, leasedAt),
    });
  }

  private forgetStaleQueued(nowMs: number): void {
    for (const [instanceId, batch] of this.queued) {
      if (nowMs - batch.leasedAt >= INBOX_LEASE_MS) this.queued.delete(instanceId);
    }
  }

  private cancelWaiter(instanceId: string): void {
    const previous = this.waiters.get(instanceId);
    if (!previous) return;
    clearTimeout(previous.timer);
    this.waiters.delete(instanceId);
    previous.resolve([]);
  }
}

function groupByInstance(leased: { instanceId: string; message: InboundMessage }[]): Map<string, InboundMessage[]> {
  const groups = new Map<string, InboundMessage[]>();
  for (const { instanceId, message } of leased) {
    groups.set(instanceId, [...(groups.get(instanceId) ?? []), message]);
  }
  return groups;
}

import type { FastifyBaseLogger } from "fastify";
import type { Instance, InstanceStatus } from "../domain/types.js";
import { ValidationError, errorMessage } from "../domain/errors.js";
import { ownerRouteOf } from "../domain/owner.js";
import { addDays, atTenantHour, tenantClockOf } from "../domain/tenant.js";
import type { EventRepository } from "../storage/event-repository.js";
import type { InstanceRepository } from "../storage/instance-repository.js";
import type { OwnerTurn } from "./agent-runtime/types.js";
import { BackgroundTasks } from "./background-tasks.js";
import type { HostRuntimes } from "./host-runtimes.js";
import { PAIR_AUTHENTICATED_EVENT } from "./pairing-manager.js";
import { TELEGRAM_LINKED_EVENT } from "./telegram/managed-bot-linker.js";

const SWEEP_INTERVAL_MS = 10 * 60_000;
// Older bots never get onboarding, whatever channel they link later.
const NEW_BOT_WINDOW_MS = 2 * 24 * 60 * 60_000;
const FIRST_CHECKIN_MIN_LEAD_MS = 3 * 60 * 60_000;
const MAX_REFUSALS = 6;
const LIVE_STATUSES: InstanceStatus[] = ["running", "degraded"];
const LINK_EVENTS = [TELEGRAM_LINKED_EVENT, PAIR_AUTHENTICATED_EVENT];
const SETTLED_EVENT = "onboarding.checkins_settled";

type Settlement =
  | { outcome: "scheduled"; channel: string; at: string[] }
  | { outcome: "unsupported" | "restored" | "expired" }
  | { outcome: "abandoned"; refusals: number };

const CHECKINS = [
  {
    dayOffset: 0,
    hour: 19,
    task: `Today's task: pick the single most useful follow-up from today. Finish something left open, take a finished task one step further, or act on something they mentioned (a meeting, a trip, a decision).
If they barely talked to you, offer one concrete thing that fits what you know about them.`,
  },
  {
    dayOffset: 1,
    hour: 9,
    task: `Today's task: propose one recurring helper that fits this owner, with the exact time and content. For example: a morning brief of today's calendar and weather, a reminder for something they mentioned, or a weekly summary.
If it needs an app they have not connected, include the connect link from the connections tool.
If they say yes, set it up and confirm in one line.`,
  },
  {
    dayOffset: 2,
    hour: 12,
    task: `Today's task: show one capability the owner has not used yet, tied to something they said. For example: a voice note, a photo of a receipt or document, a web search, a reminder, or a connected app.
Make it one step to try: "send me X and I'll do Y".`,
  },
] as const;

// A gateway that was down at the due time runs the turn whenever it is back, so staleness is the turn's own call.
function checkinMessage(due: Date, task: string): string {
  const dueUtc = `${due.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `This is a proactive check-in: you write to the owner first, in this conversation.
Goal: one message that is genuinely useful to them today. Not a greeting, not "just checking in", not a feature list.
Base it on this conversation and on what you remember about the owner. Messages that start with "[cron:" are scheduled instructions like this one, never the owner.

Reply with exactly NO_REPLY and nothing else if any of these is true:
- the Reference UTC time is more than 2 hours after ${dueUtc}
- the owner wrote to you in the last 3 hours
- the owner did not answer your last two messages to them
- the owner asked you not to message them first
- you have nothing specific and useful to offer

Write in the owner's language (Hebrew if they have not written yet): 1-2 short lines, one idea, ending with a clear yes/no or one simple next step.
When you deliver a finished result, the result may be longer, but the sentence introducing it stays one line.
Open with the useful thing itself, not with talk of check-ins or schedules; if the owner asks, say honestly that you reached out on your own.
If you can do the helpful thing now without the owner's input, do it and send the result.
Never message other people, buy, delete or change settings on your own. Offer it instead.

${task}`;
}

// The first check-in is the link day's evening when that leaves time for a first conversation, otherwise the next evening.
export function planOnboardingCheckins(linkedAt: Date): OwnerTurn[] {
  const linkDay = tenantClockOf(linkedAt).date;
  const eveningLead = atTenantHour(linkDay, CHECKINS[0].hour).getTime() - linkedAt.getTime();
  const firstDay = eveningLead >= FIRST_CHECKIN_MIN_LEAD_MS ? linkDay : addDays(linkDay, 1);
  return CHECKINS.map((checkin, index) => {
    const at = atTenantHour(addDays(firstDay, checkin.dayOffset), checkin.hour);
    return {
      key: `agentforall:onboarding-checkin-${index + 1}`,
      name: `Getting-started check-in ${index + 1} of ${CHECKINS.length}`,
      at,
      message: checkinMessage(at, checkin.task),
    };
  });
}

export class OnboardingCheckins {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private readonly refusals = new Map<string, number>();
  private readonly tasks: BackgroundTasks;

  constructor(
    private readonly repo: Pick<InstanceRepository, "findCreatedSinceWithoutEvent">,
    private readonly events: Pick<EventRepository, "append" | "firstAt">,
    private readonly hosts: HostRuntimes,
    private readonly logger: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.tasks = new BackgroundTasks(logger, "onboarding check-in sweep failed unexpectedly");
  }

  start(): void {
    if (this.intervalHandle) return;
    this.tick();
    this.intervalHandle = setInterval(() => this.tick(), SWEEP_INTERVAL_MS);
  }

  async stop(timeoutMs: number): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.tasks.settle(timeoutMs);
  }

  tick(): void {
    if (this.sweeping) return;
    this.tasks.launch(this.sweep());
  }

  // A sweep rather than a hook in each link flow: a restart, a busy gateway or a refusal is retried next time.
  async sweep(): Promise<void> {
    this.sweeping = true;
    try {
      const since = new Date(this.now().getTime() - NEW_BOT_WINDOW_MS);
      for (const bot of await this.repo.findCreatedSinceWithoutEvent(since, LIVE_STATUSES, SETTLED_EVENT)) {
        await this.settle(bot);
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async settle(bot: Instance): Promise<void> {
    try {
      if (bot.backupImport.status !== "none") {
        await this.record(bot, { outcome: "restored" });
        return;
      }
      const route = ownerRouteOf(bot);
      if (!bot.containerId || !route) return;
      const host = this.hosts.for(bot.hostId);
      if (!(await host.gate.check())) return;

      // Anchored on the link, not on this sweep: a retry plans the same instants and never repeats a turn that already ran.
      const linkedAt = (await this.events.firstAt(bot.id, LINK_EVENTS)) ?? bot.createdAt;
      const now = this.now().getTime();
      const turns = planOnboardingCheckins(linkedAt).filter((turn) => turn.at.getTime() > now);
      if (turns.length === 0) {
        await this.record(bot, { outcome: "expired" });
        return;
      }

      const outcome = await host.adapters.get(bot.runtimeKind).scheduleOwnerTurns(bot.containerId, route, turns);
      await this.record(
        bot,
        outcome === "scheduled"
          ? { outcome, channel: route.channel, at: turns.map((turn) => turn.at.toISOString()) }
          : { outcome },
      );
    } catch (err) {
      await this.failed(bot, err);
    }
  }

  // Only refusals count: an unreachable gateway is retried until the new-bot window closes.
  private async failed(bot: Instance, err: unknown): Promise<void> {
    this.logger.warn({ instanceId: bot.id, err: errorMessage(err) }, "onboarding check-ins not scheduled");
    if (!(err instanceof ValidationError)) return;
    const refusals = (this.refusals.get(bot.id) ?? 0) + 1;
    this.refusals.set(bot.id, refusals);
    if (refusals < MAX_REFUSALS) return;
    await this.record(bot, { outcome: "abandoned", refusals }).catch((recordErr: unknown) =>
      this.logger.warn({ instanceId: bot.id, err: errorMessage(recordErr) }, "onboarding check-ins not recorded"),
    );
  }

  private async record(bot: Instance, settlement: Settlement): Promise<void> {
    await this.events.append(bot.id, SETTLED_EVENT, { payload: settlement });
    this.refusals.delete(bot.id);
    this.logger.info({ instanceId: bot.id, ...settlement }, "onboarding check-ins settled");
  }
}

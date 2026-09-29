import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { OnboardingCheckins, planOnboardingCheckins } from "../src/services/onboarding-checkins.js";
import type { OwnerTurn, OwnerTurnsOutcome } from "../src/services/agent-runtime/types.js";
import type { OwnerRoute } from "../src/domain/owner.js";
import type { ChannelConfig, Instance } from "../src/domain/types.js";
import { UpstreamUnavailableError, ValidationError } from "../src/domain/errors.js";
import { makeInstance } from "./helpers/fixtures.js";
import { singleHost } from "./helpers/host-runtimes.js";

const TELEGRAM: ChannelConfig = { type: "telegram", botToken: "bot-token", allowFrom: ["tg:4242"] };
const WHATSAPP: ChannelConfig = { type: "whatsapp", ownerNumber: "+972501234567" };
const SETTLED = "onboarding.checkins_settled";

function times(linkedAt: string): string[] {
  return planOnboardingCheckins(new Date(linkedAt)).map((turn) => turn.at.toISOString());
}

test("a bot linked by the afternoon gets its first check-in that evening, then the next two days", () => {
  assert.deepEqual(times("2026-09-30T07:00:00Z"), [
    "2026-09-30T16:00:00.000Z",
    "2026-10-01T06:00:00.000Z",
    "2026-10-02T09:00:00.000Z",
  ]);
});

test("the evening check-in needs three hours of lead; with less it moves to the next evening", () => {
  assert.equal(times("2026-09-30T13:00:00Z")[0], "2026-09-30T16:00:00.000Z");
  assert.equal(times("2026-09-30T13:00:01Z")[0], "2026-10-01T16:00:00.000Z");
  assert.equal(times("2026-09-30T22:30:00Z")[0], "2026-10-01T16:00:00.000Z");
});

test("check-ins that straddle the clock change keep their Israel wall-clock hours", () => {
  assert.deepEqual(times("2026-10-23T17:00:00Z"), [
    "2026-10-24T16:00:00.000Z",
    "2026-10-25T07:00:00.000Z",
    "2026-10-26T10:00:00.000Z",
  ]);
});

test("each check-in has a stable key, its own task and its own due time to judge staleness by", () => {
  const turns = planOnboardingCheckins(new Date("2026-09-30T07:00:00Z"));
  assert.deepEqual(
    turns.map((turn) => turn.key),
    ["agentforall:onboarding-checkin-1", "agentforall:onboarding-checkin-2", "agentforall:onboarding-checkin-3"],
  );
  assert.ok(turns.every((turn) => turn.message.includes("Reply with exactly NO_REPLY")));
  assert.match(turns[0]!.message, /more than 2 hours after 2026-09-30 16:00 UTC/);
  assert.match(turns[2]!.message, /more than 2 hours after 2026-10-02 09:00 UTC/);
  assert.equal(new Set(turns.map((turn) => turn.message)).size, 3);
});

interface Harness {
  service: OnboardingCheckins;
  scheduled: Array<{ containerId: string; route: OwnerRoute; turns: readonly OwnerTurn[] }>;
  events: Array<{ id: string; type: string; payload: Record<string, unknown> | undefined }>;
  warnings: number;
  asked: Array<{ since: Date; eventType: string }>;
  clock: { now: string };
  appendFailures: { remaining: number };
}

function harness(
  bots: Instance[],
  options: {
    outcome?: () => Promise<OwnerTurnsOutcome>;
    reachable?: boolean;
    now?: string;
    linkedAt?: string | null;
  } = {},
): Harness {
  const h: Harness = {
    service: undefined as never,
    scheduled: [],
    events: [],
    warnings: 0,
    asked: [],
    clock: { now: options.now ?? "2026-09-30T07:00:00Z" },
    appendFailures: { remaining: 0 },
  };
  const adapter = {
    scheduleOwnerTurns: async (containerId: string, route: OwnerRoute, turns: readonly OwnerTurn[]) => {
      const outcome = await (options.outcome ?? (async () => "scheduled" as const))();
      h.scheduled.push({ containerId, route, turns });
      return outcome;
    },
  };
  const hosts = singleHost({} as never, { get: () => adapter } as never, { check: async () => options.reachable ?? true });
  const repo = {
    findCreatedSinceWithoutEvent: async (since: Date, _statuses: unknown, eventType: string) => {
      h.asked.push({ since, eventType });
      return bots.filter((bot) => !h.events.some((event) => event.id === bot.id && event.type === eventType));
    },
  };
  const linkedAt = options.linkedAt === undefined ? "2026-09-30T06:55:00Z" : options.linkedAt;
  const eventLog = {
    append: async (id: string, type: string, opts?: { payload?: Record<string, unknown> }) => {
      if (h.appendFailures.remaining > 0) {
        h.appendFailures.remaining -= 1;
        throw new Error("database away");
      }
      h.events.push({ id, type, payload: opts?.payload });
    },
    firstAt: async () => (linkedAt === null ? null : new Date(linkedAt)),
  };
  const logger = {
    info: () => {},
    warn: () => void (h.warnings += 1),
    error: () => void (h.warnings += 1),
  } as unknown as FastifyBaseLogger;
  h.service = new OnboardingCheckins(repo, eventLog, hosts, logger, () => new Date(h.clock.now));
  return h;
}

test("only bots created in the last two days and not yet settled are looked at", async () => {
  const h = harness([]);
  await h.service.sweep();
  assert.deepEqual(h.asked, [{ since: new Date("2026-09-28T07:00:00Z"), eventType: SETTLED }]);
});

test("a new bot with a linked owner is scheduled once, in the owner's Telegram DM", async () => {
  const bot = makeInstance([TELEGRAM, WHATSAPP]);
  const h = harness([bot]);

  await h.service.sweep();
  await h.service.sweep();

  assert.equal(h.scheduled.length, 1);
  assert.deepEqual(h.scheduled[0]?.route, { channel: "telegram", to: "4242" });
  assert.equal(h.scheduled[0]?.containerId, "container-1");
  assert.deepEqual(h.events, [
    {
      id: bot.id,
      type: SETTLED,
      payload: {
        outcome: "scheduled",
        channel: "telegram",
        at: ["2026-09-30T16:00:00.000Z", "2026-10-01T06:00:00.000Z", "2026-10-02T09:00:00.000Z"],
      },
    },
  ]);
});

test("times are anchored on the owner's link, and turns already past are left out", async () => {
  const h = harness([makeInstance([TELEGRAM])], { linkedAt: "2026-09-29T07:00:00Z", now: "2026-09-30T08:00:00Z" });
  await h.service.sweep();
  assert.deepEqual(
    h.scheduled[0]?.turns.map((turn) => turn.at.toISOString()),
    ["2026-10-01T09:00:00.000Z"],
  );
});

test("a bot whose every check-in is already past is settled as expired without scheduling", async () => {
  const h = harness([makeInstance([TELEGRAM])], { linkedAt: "2026-09-26T07:00:00Z" });
  await h.service.sweep();
  assert.equal(h.scheduled.length, 0);
  assert.deepEqual(h.events.map((event) => event.payload), [{ outcome: "expired" }]);
});

test("a bot restored from a backup, or still restoring, is not new and never gets onboarding", async () => {
  for (const status of ["restored", "pending"] as const) {
    const bot = makeInstance([TELEGRAM], {
      backupImport: { status, objectName: "x", contentLength: 1, contentType: "application/gzip" },
    });
    const h = harness([bot]);
    await h.service.sweep();
    assert.equal(h.scheduled.length, 0, status);
    assert.deepEqual(h.events.map((event) => event.payload), [{ outcome: "restored" }], status);
  }
});

test("an owner reachable only on WhatsApp is scheduled there once the number is paired", async () => {
  const paired = harness([makeInstance([WHATSAPP], { pairingStatus: "paired" })]);
  await paired.service.sweep();
  assert.deepEqual(paired.scheduled[0]?.route, { channel: "whatsapp", to: "+972501234567" });

  const waiting = harness([makeInstance([WHATSAPP], { pairingStatus: "awaiting_qr" })]);
  await waiting.service.sweep();
  assert.equal(waiting.scheduled.length, 0);
  assert.equal(waiting.events.length, 0);
});

test("a bot with no owner chat yet, or no container, waits without a record", async () => {
  const h = harness([
    makeInstance([{ type: "telegram", allowFrom: ["tg:4242"] }], { pairingStatus: "none" }),
    makeInstance([TELEGRAM], { containerId: null }),
  ]);
  await h.service.sweep();
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.events.length, 0);
});

test("a failed attempt leaves no record, so the next sweep tries again with the same instants", async () => {
  let attempts = 0;
  const h = harness([makeInstance([TELEGRAM])], {
    outcome: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("openclaw unavailable: cron.add: timeout");
      return "scheduled";
    },
  });

  await h.service.sweep();
  assert.equal(h.events.length, 0);
  assert.equal(h.warnings, 1);

  h.clock.now = "2026-09-30T07:10:00Z";
  await h.service.sweep();
  assert.deepEqual(h.events.map((event) => event.payload?.at), [
    ["2026-09-30T16:00:00.000Z", "2026-10-01T06:00:00.000Z", "2026-10-02T09:00:00.000Z"],
  ]);
});

test("a bot whose gateway keeps refusing is abandoned after six refusals instead of retrying for two days", async () => {
  const h = harness([makeInstance([TELEGRAM])], {
    outcome: async () => {
      throw new ValidationError("openclaw refused cron.add: invalid");
    },
  });

  for (let sweep = 0; sweep < 8; sweep++) await h.service.sweep();

  assert.equal(h.scheduled.length, 0);
  assert.deepEqual(h.events.map((event) => event.payload), [{ outcome: "abandoned", refusals: 6 }]);
});

test("an unreachable gateway is never counted, so a bot that comes back late still gets its check-ins", async () => {
  let calls = 0;
  const h = harness([makeInstance([TELEGRAM])], {
    outcome: async () => {
      calls += 1;
      if (calls <= 10) throw new UpstreamUnavailableError("openclaw", "cron.add: timeout");
      return "scheduled";
    },
  });

  for (let sweep = 0; sweep < 11; sweep++) await h.service.sweep();

  assert.deepEqual(h.events.map((event) => event.payload?.outcome), ["scheduled"]);
});

test("a bot with no link event is anchored on its creation, so retries still plan the same instants", async () => {
  const bot = makeInstance([TELEGRAM], { createdAt: new Date("2026-09-30T06:00:00Z") });
  const h = harness([bot], { linkedAt: null, now: "2026-09-30T20:00:00Z" });
  await h.service.sweep();
  assert.deepEqual(
    h.scheduled[0]?.turns.map((turn) => turn.at.toISOString()),
    ["2026-10-01T06:00:00.000Z", "2026-10-02T09:00:00.000Z"],
  );
});

test("a schedule whose record failed is retried with the same instants, converging instead of adding turns", async () => {
  const h = harness([makeInstance([TELEGRAM])]);
  h.appendFailures.remaining = 1;

  await h.service.sweep();
  h.clock.now = "2026-09-30T07:10:00Z";
  await h.service.sweep();

  assert.equal(h.scheduled.length, 2);
  assert.deepEqual(h.scheduled[0]?.turns.map((turn) => turn.at.getTime()), h.scheduled[1]?.turns.map((turn) => turn.at.getTime()));
  assert.deepEqual(h.events.map((event) => event.payload?.outcome), ["scheduled"]);
});

test("a runtime without a scheduler is settled once and never asked again", async () => {
  let asked = 0;
  const h = harness([makeInstance([TELEGRAM], { runtimeKind: "hermes" })], {
    outcome: async () => {
      asked += 1;
      return "unsupported";
    },
  });

  await h.service.sweep();
  await h.service.sweep();

  assert.equal(asked, 1);
  assert.deepEqual(h.events.map((event) => event.payload), [{ outcome: "unsupported" }]);
});

test("an unreachable host is skipped without a record", async () => {
  const h = harness([makeInstance([TELEGRAM])], { reachable: false });
  await h.service.sweep();
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.events.length, 0);
});

test("one bot's failure does not stop the others", async () => {
  const first = makeInstance([TELEGRAM], { id: "22222222-2222-4222-8222-222222222222" });
  const second = makeInstance([TELEGRAM]);
  let calls = 0;
  const h = harness([first, second], {
    outcome: async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "scheduled";
    },
  });

  await h.service.sweep();

  assert.deepEqual(h.events.map((event) => event.id), [second.id]);
});

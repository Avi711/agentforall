import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { BrowserTabJanitor, nightlyRunDate } from "../src/services/browser-tab-janitor.js";
import type { BrowserTabsClosed } from "../src/services/agent-runtime/types.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";
import { twoHosts } from "./helpers/host-runtimes.js";

test("the nightly run belongs to the 4 o'clock hour in Israel, whatever the clock change", () => {
  assert.equal(nightlyRunDate(new Date("2026-09-25T00:59:00Z")), null);
  assert.equal(nightlyRunDate(new Date("2026-09-25T01:00:00Z")), "2026-09-25");
  assert.equal(nightlyRunDate(new Date("2026-09-25T01:59:00Z")), "2026-09-25");
  assert.equal(nightlyRunDate(new Date("2026-09-25T02:00:00Z")), null);
  assert.equal(nightlyRunDate(new Date("2026-03-27T01:30:00Z")), "2026-03-27");
  assert.equal(nightlyRunDate(new Date("2026-10-25T02:30:00Z")), "2026-10-25");
});

interface Harness {
  janitor: BrowserTabJanitor;
  closedOn: string[];
  events: Array<{ id: string; type: string }>;
  warnings: string[];
  infos: Array<{ msg: string; ctx: Record<string, unknown> }>;
  sweeps: () => number;
  clock: { at: string };
}

function harness(
  options: {
    instances?: Instance[];
    close?: (containerId: string) => Promise<BrowserTabsClosed>;
    reachable?: Record<string, boolean>;
    at?: string;
    repoFailures?: number;
  } = {},
): Harness {
  const closedOn: string[] = [];
  const events: Array<{ id: string; type: string }> = [];
  const warnings: string[] = [];
  const infos: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
  let sweeps = 0;
  const clock = { at: options.at ?? "2026-09-25T12:00:00Z" };
  const adapter = {
    closeBrowserTabs: async (containerId: string) => {
      closedOn.push(containerId);
      return options.close ? options.close(containerId) : { closed: 2, failed: 0 };
    },
  };
  const adapters = { get: () => adapter } as never;
  const gate = (hostId: string) => ({ check: async () => options.reachable?.[hostId] ?? true });
  const hosts = twoHosts(
    { hostId: "h1", runtime: {} as never, adapters, gate: gate("h1") },
    { hostId: "h2", runtime: {} as never, adapters, gate: gate("h2") },
  );
  const repo = {
    findByStatuses: async () => {
      sweeps += 1;
      if (sweeps <= (options.repoFailures ?? 0)) throw new Error("database away");
      return options.instances ?? [];
    },
  };
  const logger = {
    info: (ctx: Record<string, unknown>, msg: string) => void infos.push({ msg, ctx }),
    warn: (_ctx: unknown, msg: string) => void warnings.push(msg),
    error: (_ctx: unknown, msg: string) => void warnings.push(msg),
  } as unknown as FastifyBaseLogger;
  const janitor = new BrowserTabJanitor(
    repo,
    hosts,
    { append: async (id: string, type: string) => void events.push({ id, type }) },
    logger,
    () => Date.parse(clock.at),
  );
  return { janitor, closedOn, events, warnings, infos, sweeps: () => sweeps, clock };
}

test("the nightly sweep runs once per night, also after a restart inside the hour, never after one later in the day", async () => {
  const night = harness({ at: "2026-09-25T01:10:00Z" });
  night.janitor.tick();
  night.clock.at = "2026-09-25T01:20:00Z";
  night.janitor.tick();
  await night.janitor.settle();
  assert.equal(night.sweeps(), 1);

  const restartedAt0410 = harness({ at: "2026-09-25T01:10:00Z" });
  restartedAt0410.janitor.tick();
  await restartedAt0410.janitor.settle();
  assert.equal(restartedAt0410.sweeps(), 1);

  const restartedAt0900 = harness({ at: "2026-09-25T06:00:00Z" });
  restartedAt0900.janitor.tick();
  await restartedAt0900.janitor.settle();
  assert.equal(restartedAt0900.sweeps(), 0);
});

test("the sweep closes tabs on every reachable bot with a container and logs one summary", async () => {
  const h = harness({
    instances: [
      makeInstance([], { id: "a", hostId: "h1", containerId: "c-a" }),
      makeInstance([], { id: "b", hostId: "h2", containerId: "c-b" }),
      makeInstance([], { id: "c", hostId: "h1", containerId: null }),
    ],
    reachable: { h2: false },
  });
  await h.janitor.sweepFleet();
  assert.deepEqual(h.closedOn, ["c-a"]);
  const summary = h.infos.find((l) => l.msg === "nightly browser tab cleanup");
  assert.deepEqual(summary?.ctx, { bots: 1, closed: 2, failed: 0 });
  assert.deepEqual(h.events, [], "nightly closes are not instance events");
});

test("high memory closes the bot's tabs and records it; nothing closed records nothing", async () => {
  const bot = makeInstance([], { id: "a", hostId: "h1", containerId: "c-a" });
  const h = harness();
  h.janitor.memoryHigh(bot, 3300, 4096);
  await h.janitor.settle();
  assert.deepEqual(h.closedOn, ["c-a"]);
  assert.deepEqual(h.events, [{ id: "a", type: "instance.browser_tabs_closed" }]);

  const empty = harness({ close: async () => ({ closed: 0, failed: 0 }) });
  empty.janitor.memoryHigh(bot, 3300, 4096);
  await empty.janitor.settle();
  assert.deepEqual(empty.events, []);
});

test("a failing cleanup is logged, never thrown, and one bot is never cleaned twice at once", async () => {
  const bot = makeInstance([], { id: "a", hostId: "h1", containerId: "c-a" });
  const failing = harness({
    close: async () => {
      throw new Error("exec failed");
    },
  });
  failing.janitor.memoryHigh(bot, 3300, 4096);
  await failing.janitor.settle();
  assert.deepEqual(failing.warnings, ["browser tab cleanup failed"]);

  let release: (value: BrowserTabsClosed) => void = () => undefined;
  const slow = harness({ close: () => new Promise((resolve) => (release = resolve)) });
  slow.janitor.memoryHigh(bot, 3300, 4096);
  slow.janitor.memoryHigh(bot, 3300, 4096);
  release({ closed: 1, failed: 0 });
  await slow.janitor.settle();
  assert.equal(slow.closedOn.length, 1);
});

test("a night whose sweep failed is retried within the same hour", async () => {
  const h = harness({ at: "2026-09-25T01:05:00Z", repoFailures: 1 });
  h.janitor.tick();
  await h.janitor.settle();
  h.clock.at = "2026-09-25T01:10:00Z";
  h.janitor.tick();
  await h.janitor.settle();
  h.clock.at = "2026-09-25T01:15:00Z";
  h.janitor.tick();
  await h.janitor.settle();
  assert.equal(h.sweeps(), 2);
});

test("a bot on a host this orchestrator does not know is skipped, the rest are cleaned and summarised", async () => {
  const h = harness({
    instances: [
      makeInstance([], { id: "a", hostId: "h1", containerId: "c-a" }),
      makeInstance([], { id: "x", hostId: "gone", containerId: "c-x" }),
    ],
  });
  await h.janitor.sweepFleet();
  assert.deepEqual(h.closedOn, ["c-a"]);
  assert.ok(h.infos.some((l) => l.msg === "nightly browser tab cleanup"));
});

test("a memory episode gets at most 3 attempts, stops after the first success, and starts over once back to normal", async () => {
  const bot = makeInstance([], { id: "a", hostId: "h1", containerId: "c-a" });
  const failing = harness({
    close: async () => {
      throw new Error("exec failed");
    },
  });
  for (let sweep = 0; sweep < 5; sweep++) {
    failing.janitor.memoryHigh(bot, 3300, 4096);
    await failing.janitor.settle();
  }
  assert.equal(failing.closedOn.length, 3);

  const working = harness();
  for (let sweep = 0; sweep < 3; sweep++) {
    working.janitor.memoryHigh(bot, 3300, 4096);
    await working.janitor.settle();
  }
  assert.equal(working.closedOn.length, 1);
  working.janitor.memoryNormal("a");
  working.janitor.memoryHigh(bot, 3300, 4096);
  await working.janitor.settle();
  assert.equal(working.closedOn.length, 2);
});

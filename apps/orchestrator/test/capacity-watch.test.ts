import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { CapacityWatch } from "../src/services/capacity-watch.js";

const HOUR = 60 * 60_000;

function harness(rooms: Array<number | Error>) {
  const lines: Array<{ level: string; msg: string; ctx: Record<string, unknown> }> = [];
  const record = (level: string) => (ctx: Record<string, unknown>, msg: string) => void lines.push({ level, msg, ctx });
  const logger = { info: record("info"), warn: record("warn"), error: record("error") } as unknown as FastifyBaseLogger;
  let calls = 0;
  const placement = {
    capacity: async () => {
      const next = rooms[Math.min(calls, rooms.length - 1)]!;
      calls += 1;
      if (next instanceof Error) throw next;
      return { room: next, hosts: [{ hostId: "w", room: next, headroomMb: next * 1024, skipped: null }] };
    },
  };
  const clock = { nowMs: 0 };
  const watch = new CapacityWatch(placement, logger, { warnBots: 10, memoryMb: 3072 }, () => clock.nowMs);
  const of = (msg: string) => lines.filter((l) => l.msg === msg);
  return { watch, lines, of, clock, calls: () => calls };
}

test("low room warns once, again only after 6 hours, and says when it is restored", async () => {
  const h = harness([3, 3, 3, 15, 15]);
  await h.watch.evaluate();
  h.clock.nowMs = 1 * HOUR;
  await h.watch.evaluate();
  assert.equal(h.of("fleet capacity low").length, 1);
  h.clock.nowMs = 6 * HOUR;
  await h.watch.evaluate();
  assert.equal(h.of("fleet capacity low").length, 2);
  assert.deepEqual(h.of("fleet capacity low")[0]!.ctx.room, 3);
  await h.watch.evaluate();
  await h.watch.evaluate();
  assert.equal(h.of("fleet capacity restored").length, 1);
});

test("plenty of room from the start logs nothing", async () => {
  const h = harness([30]);
  await h.watch.evaluate();
  assert.deepEqual(h.lines, []);
});

test("a failed check is logged and never thrown; overlapping sweeps evaluate once", async () => {
  const failing = harness([new Error("docker away")]);
  await failing.watch.evaluate();
  assert.equal(failing.of("fleet capacity check failed").length, 1);

  const h = harness([30]);
  h.watch.swept();
  h.watch.swept();
  await h.watch.settle();
  assert.equal(h.calls(), 1);
});

test("room hovering at the threshold neither restores nor re-warns until it clears a margin", async () => {
  const h = harness([9, 10, 9, 14, 9, 15]);
  for (let i = 0; i < 4; i++) await h.watch.evaluate();
  assert.equal(h.of("fleet capacity low").length, 1);
  assert.equal(h.of("fleet capacity restored").length, 0);
  await h.watch.evaluate();
  await h.watch.evaluate();
  assert.equal(h.of("fleet capacity restored").length, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { MemoryWatch } from "../src/services/memory-watch.js";
import type { ContainerMemory } from "../src/services/container-runtime.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const GB = 1024 * 1024 * 1024;

interface Line {
  level: "info" | "warn" | "error";
  msg: string;
  ctx: Record<string, unknown>;
}

function recordingLogger(lines: Line[]): FastifyBaseLogger {
  const record = (level: Line["level"]) => (ctx: unknown, msg?: string) => {
    if (typeof ctx === "string") lines.push({ level, msg: ctx, ctx: {} });
    else if (msg) lines.push({ level, msg, ctx: { ...(ctx as Record<string, unknown>) } });
  };
  return { info: record("info"), warn: record("warn"), error: record("error") } as unknown as FastifyBaseLogger;
}

function harness(usage: Record<string, ContainerMemory | null | Error>, options: { repoError?: Error } = {}) {
  const lines: Line[] = [];
  const instances: Instance[] = Object.keys(usage).map((id) =>
    makeInstance([], { id, containerId: id === "detached" ? null : `c-${id}` }),
  );
  const repo = {
    findByStatuses: async () => {
      if (options.repoError) throw options.repoError;
      return instances;
    },
  };
  const runtime = {
    memoryUsage: async (containerId: string) => {
      const value = usage[containerId.slice(2)];
      if (value instanceof Error) throw value;
      return value ?? null;
    },
  };
  const watch = new MemoryWatch(repo, runtime, recordingLogger(lines), { intervalMs: 60_000, warnFraction: 0.8 });
  const of = (msg: string) => lines.filter((l) => l.msg === msg);
  return { watch, lines, of, usage, instances };
}

test("warns once when a bot crosses the fraction, and once more when it recovers", async () => {
  const h = harness({ a: { usedBytes: 2.6 * GB, limitBytes: 3 * GB } });

  await h.watch.sweep();
  await h.watch.sweep();
  assert.deepEqual(
    h.of("bot memory high").map((l) => l.ctx),
    [{ instanceId: "a", usedMb: 2662, limitMb: 3072 }],
  );

  h.usage.a = { usedBytes: 1 * GB, limitBytes: 3 * GB };
  await h.watch.sweep();
  await h.watch.sweep();
  assert.deepEqual(
    h.of("bot memory back to normal").map((l) => l.ctx),
    [{ instanceId: "a", usedMb: 1024, limitMb: 3072 }],
  );
});

test("a bot under the fraction, without a limit, or without a container is never mentioned", async () => {
  const h = harness({
    a: { usedBytes: 1 * GB, limitBytes: 3 * GB },
    b: { usedBytes: 5 * GB, limitBytes: 0 },
    detached: { usedBytes: 5 * GB, limitBytes: 1 * GB },
  });

  await h.watch.sweep();

  assert.deepEqual(h.lines, []);
});

test("a stats error is logged and a gone container is skipped; neither throws", async () => {
  const h = harness({ a: new Error("docker away"), b: null, c: { usedBytes: 3 * GB, limitBytes: 3 * GB } });

  await h.watch.sweep();

  assert.deepEqual(
    h.lines.map((l) => [l.level, l.ctx.instanceId, l.msg]),
    [
      ["warn", "a", "memory stats unavailable"],
      ["warn", "c", "bot memory high"],
    ],
  );
});

test("a repository outage is logged and the next sweep runs normally", async () => {
  const boom = new Error("db down");
  const options = { repoError: boom as Error | undefined };
  const h = harness({ a: { usedBytes: 3 * GB, limitBytes: 3 * GB } }, options);

  await h.watch.sweep();
  assert.deepEqual(h.lines.map((l) => [l.level, l.msg]), [["error", "memory watch sweep failed"]]);

  options.repoError = undefined;
  await h.watch.sweep();
  assert.equal(h.of("bot memory high").length, 1);
});

test("a bot that leaves the active set while high is forgotten, not reported as recovered", async () => {
  const h = harness({ a: { usedBytes: 3 * GB, limitBytes: 3 * GB } });

  await h.watch.sweep();
  h.instances.length = 0;
  await h.watch.sweep();
  assert.equal(h.of("bot memory back to normal").length, 0);

  h.instances.push(makeInstance([], { id: "a", containerId: "c-a" }));
  await h.watch.sweep();
  assert.equal(h.of("bot memory high").length, 2, "re-warned after returning");
});

test("sweeps never overlap and stop waits for the one in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const runtime = {
    memoryUsage: async () => {
      calls += 1;
      await gate;
      return { usedBytes: 0, limitBytes: 1 };
    },
  };
  const repo = { findByStatuses: async () => [makeInstance([], { id: "a", containerId: "c-a" })] };
  const watch = new MemoryWatch(repo, runtime, recordingLogger([]), { intervalMs: 60_000, warnFraction: 0.8 });

  const first = watch.sweep();
  await watch.sweep();
  assert.equal(calls, 1, "second sweep skipped while the first is in flight");

  let stopped = false;
  const stopping = watch.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false, "stop waits for the sweep");

  release();
  await first;
  await stopping;
  assert.equal(stopped, true);
});

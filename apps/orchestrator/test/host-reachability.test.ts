import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { HostReachability } from "../src/services/host-reachability.js";

function harness() {
  const answers: boolean[] = [];
  const logs: string[] = [];
  let pings = 0;
  let release: (() => void) | null = null;
  const runtime = {
    ping: async () => {
      pings += 1;
      if (release === null) {
        if (!answers.shift()) throw new Error("ECONNREFUSED");
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  } as unknown as ContainerRuntime;
  const logger = {
    warn: (_: unknown, msg: string) => void logs.push(msg),
    info: (_: unknown, msg: string) => void logs.push(msg),
  } as unknown as FastifyBaseLogger;
  return {
    reachability: new HostReachability("agent-forall-vm", runtime, logger),
    answers,
    logs,
    pings: () => pings,
    holdPing: () => {
      release = () => {};
    },
    releasePing: () => release?.(),
  };
}

test("a host that keeps answering is reachable and never logged", async () => {
  const { reachability, answers, logs } = harness();
  answers.push(true, true);
  assert.equal(await reachability.check(), true);
  assert.equal(await reachability.check(), true);
  assert.deepEqual(logs, []);
});

test("one missed ping is tolerated; the second in a row opens the breaker, and one answer closes it, each logged once", async () => {
  const { reachability, answers, logs } = harness();
  answers.push(false, false, false, true, true);
  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) results.push(await reachability.check());
  assert.deepEqual(results, [true, false, false, true, true]);
  assert.deepEqual(logs, ["host unreachable", "host reachable again"]);
});

test("misses do not accumulate across answers: miss, answer, miss stays reachable", async () => {
  const { reachability, answers, logs } = harness();
  answers.push(false, true, false, true);
  const results: boolean[] = [];
  for (let i = 0; i < 4; i++) results.push(await reachability.check());
  assert.deepEqual(results, [true, true, true, true]);
  assert.deepEqual(logs, []);
});

test("concurrent checks share one ping", async () => {
  const h = harness();
  h.holdPing();
  const first = h.reachability.check();
  const second = h.reachability.check();
  await new Promise((r) => setImmediate(r));
  h.releasePing();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.pings(), 1);
});

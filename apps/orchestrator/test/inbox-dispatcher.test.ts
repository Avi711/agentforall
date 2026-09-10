import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { InboxDispatcher } from "../src/services/whatsapp-cloud/inbox-dispatcher.js";
import type { InboundMessage } from "../src/domain/whatsapp-cloud.js";
import type { DroppedMessage, LeaseResult, LeasedMessage } from "../src/storage/whatsapp-cloud-repository.js";
import { INBOX_LEASE_MS } from "../src/domain/whatsapp-cloud.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const silentLog = { warn() {}, info() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;

function message(id: string, from = "972501234567"): InboundMessage {
  return { id, wamid: `wamid.${id}`, from, profileName: null, timestamp: new Date(0), message: { type: "text" } };
}

interface HarnessOptions {
  dropped?: DroppedMessage[];
  now?: () => Date;
  leaseGate?: () => Promise<void>;
  log?: FastifyBaseLogger;
}

function harness(pending: Record<string, InboundMessage[]>, opts: HarnessOptions = {}) {
  const leaseCalls: string[][] = [];
  const events: { instanceId: string; type: string; payload: unknown }[] = [];
  const store = {
    leasePending: async (instanceIds: string[]): Promise<LeaseResult> => {
      leaseCalls.push(instanceIds);
      const out: LeasedMessage[] = [];
      for (const id of instanceIds) {
        for (const msg of pending[id] ?? []) out.push({ instanceId: id, item: msg });
        pending[id] = [];
      }
      await opts.leaseGate?.();
      return { leased: out, malformed: 0 };
    },
    sweep: async () => ({ dropped: opts.dropped ?? [], backlog: [], releasedNumbers: 0 }),
  };
  const eventLog = {
    append: async (instanceId: string, type: string, o?: { payload?: unknown }) => {
      events.push({ instanceId, type, payload: o?.payload });
    },
  };
  const dispatcher = new InboxDispatcher(store, eventLog, opts.log ?? silentLog, { pollIntervalMs: 10, sweepIntervalMs: 10 }, opts.now);
  return { dispatcher, leaseCalls, events };
}

test("a tick leases only for bots that are waiting and hands each its own messages in order", async () => {
  const { dispatcher, leaseCalls } = harness({ [A]: [message("1"), message("2")], [B]: [message("3")] });

  const waitingA = dispatcher.wait(A, 1000);
  await dispatcher.tick();
  const gotA = await waitingA;

  assert.deepEqual(gotA.map((m) => m.id), ["1", "2"]);
  assert.deepEqual(leaseCalls, [[A]]);

  const waitingB = dispatcher.wait(B, 1000);
  await dispatcher.tick();
  assert.deepEqual((await waitingB).map((m) => m.id), ["3"]);
});

test("a NOTIFY wakes a tick only for a bot that is waiting, and a tick in progress goes once more", async () => {
  const pending: Record<string, InboundMessage[]> = { [A]: [], [B]: [message("9")] };
  const { dispatcher, leaseCalls } = harness(pending);

  dispatcher.wake(A);
  assert.deepEqual(leaseCalls, []);

  const waitingA = dispatcher.wait(A, 1000);
  pending[A] = [message("1")];
  dispatcher.wake(A);
  assert.deepEqual(await waitingA, [message("1")]);
  assert.deepEqual(leaseCalls, [[A]]);

  const waitingB = dispatcher.wait(B, 1000);
  const waitingAgain = dispatcher.wait(A, 1000);
  dispatcher.start();
  const first = dispatcher.tick();
  pending[A] = [message("2")];
  dispatcher.wake(A);
  await first;
  dispatcher.stop();
  assert.deepEqual(await waitingB, [message("9")]);
  assert.deepEqual(await waitingAgain, [message("2")]);
  assert.deepEqual(leaseCalls, [[A], [B, A], [A]]);
});

test("a wait with nothing queued resolves empty at its deadline", async () => {
  const { dispatcher, leaseCalls } = harness({});
  const started = Date.now();

  const items = await dispatcher.wait(A, 30);

  assert.deepEqual(items, []);
  assert.ok(Date.now() - started >= 25);
  assert.deepEqual(leaseCalls, []);
});

test("a newer poll from the same bot replaces the older one", async () => {
  const { dispatcher } = harness({ [A]: [message("1")] });

  const first = dispatcher.wait(A, 1000);
  const second = dispatcher.wait(A, 1000);
  await dispatcher.tick();

  assert.deepEqual(await first, []);
  assert.deepEqual((await second).map((m) => m.id), ["1"]);
});

test("stop releases every waiter", async () => {
  const { dispatcher } = harness({});
  const waiting = dispatcher.wait(A, 10_000);
  dispatcher.stop();
  assert.deepEqual(await waiting, []);
});

test("the sweeper records every dropped message as an instance event", async () => {
  const { dispatcher, events } = harness({}, { dropped: [{ instanceId: A, wamid: "wamid.x", attempts: 20 }] });

  await dispatcher.sweep();

  assert.deepEqual(events, [
    { instanceId: A, type: "whatsapp_cloud.inbound_dropped", payload: { wamid: "wamid.x", attempts: 20 } },
  ]);
});

test("a wake queries only the woken bot, not every waiter", async () => {
  const { dispatcher, leaseCalls } = harness({ [A]: [message("1")], [B]: [message("2")] });
  const waitingA = dispatcher.wait(A, 1000);
  const waitingB = dispatcher.wait(B, 1000);

  dispatcher.wake(A);
  assert.deepEqual(await waitingA, [message("1")]);
  assert.deepEqual(leaseCalls, [[A]]);

  dispatcher.stop();
  assert.deepEqual(await waitingB, []);
});

test("rows leased for a bot that stopped waiting are handed to its next poll only inside the lease", async () => {
  let clock = new Date("2026-09-10T10:00:00Z").getTime();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { dispatcher } = harness({ [A]: [message("1")] }, { now: () => new Date(clock), leaseGate: () => gate });

  const first = dispatcher.wait(A, 1000);
  const tick = dispatcher.tick();
  const replaced = dispatcher.wait(A, 1);
  assert.deepEqual(await first, []);
  assert.deepEqual(await replaced, []);
  release();
  await tick;

  clock += INBOX_LEASE_MS - 1;
  assert.deepEqual(await dispatcher.wait(A, 1), [message("1")]);
});

test("a batch that outlived its lease is never handed out, and the sweeper forgets it", async () => {
  let clock = new Date("2026-09-10T10:00:00Z").getTime();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { dispatcher } = harness({ [A]: [message("1")] }, { now: () => new Date(clock), leaseGate: () => gate });

  const first = dispatcher.wait(A, 1000);
  const tick = dispatcher.tick();
  const replaced = dispatcher.wait(A, 1);
  await Promise.all([first, replaced]);
  release();
  await tick;

  clock += INBOX_LEASE_MS;
  await dispatcher.sweep();
  assert.deepEqual(await dispatcher.wait(A, 1), []);
});

test("merged batches keep the older batch's clock, so the lease guard judges by the oldest rows", async () => {
  let clock = new Date("2026-09-10T10:00:00Z").getTime();
  const gates: (() => void)[] = [];
  const { dispatcher } = harness(
    { [A]: [message("1")] },
    {
      now: () => new Date(clock),
      leaseGate: () =>
        new Promise<void>((resolve) => {
          gates.push(resolve);
        }),
    },
  );

  const queueBatch = async () => {
    const waiting = dispatcher.wait(A, 1000);
    const tick = dispatcher.tick();
    const replaced = dispatcher.wait(A, 1);
    await Promise.all([waiting, replaced]);
    gates.shift()?.();
    await tick;
  };
  await queueBatch();
  clock += INBOX_LEASE_MS / 2;
  await queueBatch();
  clock += INBOX_LEASE_MS / 2;

  assert.deepEqual(await dispatcher.wait(A, 1), []);
});

test("the sweeper names every bot whose backlog is older than the warning threshold", async () => {
  const warnings: unknown[] = [];
  const log = { warn: (o: unknown) => warnings.push(o), info() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;
  const { dispatcher } = harness({}, { log });
  const store = (dispatcher as unknown as { store: { sweep: () => Promise<unknown> } }).store;
  store.sweep = async () => ({ dropped: [], backlog: [{ instanceId: A, pending: 12, oldestReceivedAt: new Date(0) }], releasedNumbers: 1 });

  await dispatcher.sweep();

  assert.deepEqual(warnings, [
    { instanceId: A, pending: 12, oldestReceivedAt: "1970-01-01T00:00:00.000Z" },
    { released: 1 },
  ]);
});

test("a wait after stop resolves at once instead of holding the connection open", async () => {
  const { dispatcher, leaseCalls } = harness({ [A]: [message("1")] });
  dispatcher.stop();
  const started = Date.now();

  assert.deepEqual(await dispatcher.wait(A, 5_000), []);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(leaseCalls, []);
});

test("the lease clock starts before the query, so a slow lease is not handed out past its expiry", async () => {
  let clock = new Date("2026-09-10T10:00:00Z").getTime();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { dispatcher } = harness({ [A]: [message("1")] }, { now: () => new Date(clock), leaseGate: () => gate });

  const first = dispatcher.wait(A, 1000);
  const tick = dispatcher.tick();
  const replaced = dispatcher.wait(A, 1);
  await Promise.all([first, replaced]);
  clock += INBOX_LEASE_MS;
  release();
  await tick;

  assert.deepEqual(await dispatcher.wait(A, 1), []);
});

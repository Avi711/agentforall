import { test } from "node:test";
import assert from "node:assert/strict";
import { PollLoop } from "./poll-loop.js";

const silent = { warn() {}, info() {} };
const item = (id, wamid = `wamid.${id}`) => ({ id, wamid, from: "972501234567", profileName: null, timestamp: "1970-01-01T00:00:00.000Z", message: { type: "text", text: { body: `m${id}` } } });

function fakeRelay(batches) {
  const acked = [];
  let pulls = 0;
  const relay = {
    pull: async (_wait, signal) => {
      pulls += 1;
      while (!signal.aborted) {
        const next = batches.shift();
        if (next instanceof Error) throw next;
        if (next) return next;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return [];
    },
    ack: async (ids) => {
      acked.push(...ids);
      return ids.length;
    },
  };
  return { relay, acked, pulls: () => pulls };
}

test("messages are handled in order, acked after the handler returns, and a late redelivery is acked without a turn", async () => {
  const handled = [];
  const batches = [[item("1"), item("2")]];
  const { relay, acked } = fakeRelay(batches);
  const loop = new PollLoop({ relay, log: silent, handle: async (m) => handled.push(m.text) });

  loop.start();
  await waitFor(() => acked.length === 2);
  batches.push([item("3", "wamid.1")]);
  await waitFor(() => acked.length === 3);
  await loop.stop();

  assert.deepEqual(handled, ["m1", "m2"]);
  assert.deepEqual(acked, ["1", "2", "3"]);
  assert.equal(loop.state.connected, true);
});

test("customers run side by side, each in order, and a redelivery of an in-flight message is ignored", async () => {
  const started = [];
  const release = new Map();
  const { relay, acked } = fakeRelay([
    [item("1"), item("2"), { ...item("3"), from: "972500000002" }],
    [item("1")],
  ]);
  const loop = new PollLoop({
    relay,
    log: silent,
    handle: (m) =>
      new Promise((resolve) => {
        started.push(m.wamid);
        release.set(m.wamid, resolve);
      }),
  });

  loop.start();
  await waitFor(() => started.length === 2);
  assert.deepEqual(started, ["wamid.1", "wamid.3"]);
  release.get("wamid.1")();
  await waitFor(() => started.length === 3);
  assert.equal(started[2], "wamid.2");
  release.get("wamid.2")();
  release.get("wamid.3")();
  await waitFor(() => acked.length === 3);
  await loop.stop();

  assert.deepEqual(started, ["wamid.1", "wamid.3", "wamid.2"]);
  assert.deepEqual(acked.sort(), ["1", "2", "3"]);
});

test("a failure holds the rest of that customer's lane so a redelivery restores the order", async () => {
  const handled = [];
  const { relay, acked } = fakeRelay([[item("1"), item("2"), { ...item("3"), from: "972500000002" }]]);
  const loop = new PollLoop({
    relay,
    log: silent,
    handle: async (m) => {
      if (m.wamid === "wamid.1") throw new Error("agent down");
      handled.push(m.wamid);
    },
  });

  loop.start();
  await waitFor(() => acked.length === 1);
  await loop.stop();

  assert.deepEqual(handled, ["wamid.3"]);
  assert.deepEqual(acked, ["3"]);
  assert.equal(loop.lanes.size, 0);
});

test("a turn that never settles is given up on after the timeout and the loop keeps its room", async () => {
  const { relay, acked } = fakeRelay([[item("1")], [{ ...item("2"), from: "972500000002" }]]);
  const loop = new PollLoop({
    relay,
    log: silent,
    maxInFlight: 1,
    handleTimeoutMs: 30,
    handle: (m) => (m.wamid === "wamid.1" ? new Promise(() => {}) : Promise.resolve()),
  });

  loop.start();
  await waitFor(() => acked.length === 1);
  await loop.stop();

  assert.deepEqual(acked, ["2"]);
});

test("the lane cap holds within one batch; stop drops what never started so it is redelivered", async () => {
  const { relay, acked } = fakeRelay([[item("1"), { ...item("2"), from: "972500000002" }]]);
  const release = [];
  const loop = new PollLoop({ relay, log: silent, maxInFlight: 1, handle: () => new Promise((r) => release.push(r)) });

  loop.start();
  await waitFor(() => release.length === 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(release.length, 1);
  assert.equal(loop.pending.length, 1);
  const stopping = loop.stop();
  release[0]();
  await stopping;
  assert.equal(loop.lanes.size, 0);
  assert.equal(loop.pending.length, 0);
  assert.deepEqual(acked, ["1"]);
  assert.equal(loop.inFlight.size, 0);
});

test("after a failure the customer's later messages wait for the failed one to come back, then run in order", async () => {
  const handled = [];
  let fail = true;
  const batches = [[item("1"), item("2")]];
  const { relay, acked } = fakeRelay(batches);
  const loop = new PollLoop({
    relay,
    log: silent,
    handle: async (m) => {
      if (m.wamid === "wamid.1" && fail) {
        fail = false;
        throw new Error("agent down");
      }
      handled.push(m.wamid);
    },
  });

  loop.start();
  await waitFor(() => loop.failedHead.size === 1 && loop.lanes.size === 0);
  batches.push([item("3")]);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(handled, []);
  batches.push([item("1"), item("2"), item("3")]);
  await waitFor(() => acked.length === 3);
  await loop.stop();

  assert.deepEqual(handled, ["wamid.1", "wamid.2", "wamid.3"]);
});

test("a turn that finishes after its timeout is acked late, so its redelivery never runs a second turn", async () => {
  const turns = [];
  let finish;
  const batches = [[item("1")]];
  const { relay, acked } = fakeRelay(batches);
  const loop = new PollLoop({
    relay,
    log: silent,
    handleTimeoutMs: 20,
    handle: (m) => {
      turns.push(m.wamid);
      return new Promise((r) => (finish = r));
    },
  });

  loop.start();
  await waitFor(() => turns.length === 1 && loop.lanes.size === 0);
  batches.push([item("1")]);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(turns, ["wamid.1"]);
  finish();
  await waitFor(() => acked.length === 1);
  batches.push([item("1")]);
  await waitFor(() => acked.length === 2);
  await loop.stop();

  assert.deepEqual(turns, ["wamid.1"]);
  assert.equal(loop.failedHead.size, 0);
});

test("a customer held behind a failed message that never comes back is released after the turn timeout", async () => {
  const handled = [];
  const batches = [[item("1")]];
  const { relay, acked } = fakeRelay(batches);
  const loop = new PollLoop({
    relay,
    log: silent,
    handleTimeoutMs: 40,
    handle: async (m) => {
      if (m.wamid === "wamid.1") throw new Error("agent down");
      handled.push(m.wamid);
    },
  });

  loop.start();
  await waitFor(() => loop.failedHead.size === 1);
  batches.push([item("2")]);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(handled, []);
  await new Promise((r) => setTimeout(r, 40));
  batches.push([item("2")]);
  await waitFor(() => handled.length === 1);
  await loop.stop();

  assert.deepEqual(handled, ["wamid.2"]);
  assert.deepEqual(acked, ["2"]);
});

test("a turn that never settles is presumed dead after a second timeout, so its redelivery runs again", async () => {
  const turns = [];
  const batches = [[item("1")]];
  const { relay } = fakeRelay(batches);
  const loop = new PollLoop({
    relay,
    log: silent,
    handleTimeoutMs: 20,
    handle: (m) => {
      turns.push(m.wamid);
      return new Promise(() => {});
    },
  });

  loop.start();
  await waitFor(() => turns.length === 1 && loop.lanes.size === 0);
  batches.push([item("1")]);
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(turns, ["wamid.1"]);
  await new Promise((r) => setTimeout(r, 40));
  batches.push([item("1")]);
  await waitFor(() => turns.length === 2);
  await loop.stop();
});

test("stop returns within its grace while a turn is still running, and the turn's late ack still lands", async () => {
  let finish;
  const { relay, acked } = fakeRelay([[item("1")]]);
  const loop = new PollLoop({ relay, log: silent, stopGraceMs: 30, handle: () => new Promise((r) => (finish = r)) });

  loop.start();
  await waitFor(() => Boolean(finish));
  const started = Date.now();
  await loop.stop();
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(acked, []);

  finish();
  await waitFor(() => acked.length === 1);
});

test("a failed handler leaves the message unacked for the orchestrator to redeliver", async () => {
  const { relay, acked } = fakeRelay([[item("1")]]);
  const loop = new PollLoop({ relay, log: silent, handle: async () => { throw new Error("agent down"); } });

  loop.start();
  await new Promise((r) => setTimeout(r, 30));
  await loop.stop();

  assert.deepEqual(acked, []);
});

test("relay failures back off and recover; a revoked token stops the loop", async () => {
  const sleeps = [];
  const flaky = fakeRelay([new Error("ECONNREFUSED"), [item("1")]]);
  const loop = new PollLoop({ relay: flaky.relay, log: silent, handle: async () => {}, sleep: async (ms) => { sleeps.push(ms); } });
  loop.start();
  await waitFor(() => flaky.acked.length === 1);
  await loop.stop();
  assert.deepEqual(sleeps, [1000]);
  assert.equal(loop.state.connected, true);

  const revoked = fakeRelay([Object.assign(new Error("unauthorized"), { status: 401 })]);
  const dead = new PollLoop({ relay: revoked.relay, log: silent, handle: async () => {} });
  dead.start();
  await dead.done;
  assert.equal(dead.state.unauthorized, true);
  assert.equal(dead.state.connected, false);
  assert.equal(revoked.pulls(), 1);
});

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

import { describeInbound } from "./inbound.js";
import { errorLabel } from "./relay-client.js";

const WAIT_MS = 25_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const SEEN_LIMIT = 500;
const MAX_CUSTOMERS_IN_FLIGHT = 8;
const HANDLE_TIMEOUT_MS = 10 * 60_000;
// A stop waits this long for running turns; a turn still going is left to ack late (inFlight keeps it single).
const STOP_GRACE_MS = 5_000;

class TurnTimeout extends Error {
  constructor(wamid, ms) {
    super(`agent turn for ${wamid} exceeded ${ms}ms`);
    this.name = "TurnTimeout";
  }
}

// Long polling against the orchestrator; at-least-once, acked after the turn, one lane per customer.
export class PollLoop {
  constructor({
    relay,
    handle,
    log,
    waitMs = WAIT_MS,
    maxInFlight = MAX_CUSTOMERS_IN_FLIGHT,
    handleTimeoutMs = HANDLE_TIMEOUT_MS,
    stopGraceMs = STOP_GRACE_MS,
    sleep = defaultSleep,
  }) {
    this.relay = relay;
    this.handle = handle;
    this.log = log;
    this.waitMs = waitMs;
    this.maxInFlight = maxInFlight;
    this.handleTimeoutMs = handleTimeoutMs;
    this.stopGraceMs = stopGraceMs;
    this.sleep = sleep;
    this.seen = new Set();
    this.inFlight = new Set();
    this.lanes = new Map();
    this.pending = [];
    this.failedHead = new Map();
    this.controller = null;
    this.state = { connected: false, lastError: null, lastPollAt: null, unauthorized: false };
    this.done = Promise.resolve();
  }

  start() {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    // A start right behind a stop waits for the old run to finish instead of orphaning it.
    this.done = this.done.then(() => this.run(controller.signal));
  }

  // Pending items are never started once stopping: unacked, the orchestrator redelivers them.
  async stop() {
    this.controller?.abort();
    this.controller = null;
    for (const item of this.pending.splice(0)) this.inFlight.delete(item.wamid);
    await this.done;
    await Promise.race([Promise.allSettled([...this.lanes.values()]), grace(this.stopGraceMs)]);
  }

  async run(signal) {
    let backoff = BACKOFF_MIN_MS;
    while (!signal.aborted) {
      await this.waitForRoom(signal);
      if (signal.aborted) break;
      let items;
      try {
        items = await this.relay.pull(this.waitMs, signal);
        this.state.connected = true;
        this.state.lastError = null;
        this.state.lastPollAt = Date.now();
        backoff = BACKOFF_MIN_MS;
      } catch (err) {
        if (signal.aborted) break;
        this.state.connected = false;
        this.state.lastError = errorLabel(err);
        if (err?.status === 401) {
          // A revoked relay token never heals on its own; stop and let the status surface say so.
          this.state.unauthorized = true;
          this.log?.warn?.("whatsapp cloud relay rejected the token; polling stopped");
          return;
        }
        this.log?.warn?.(`whatsapp cloud poll failed: ${this.state.lastError}`);
        await this.sleep(backoff, signal);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        continue;
      }
      for (const item of items) this.enqueue(item);
    }
  }

  // One lane per customer keeps their messages in order; up to maxInFlight lanes run side by side.
  enqueue(item) {
    if (this.seen.has(item.wamid)) {
      void this.ackQuietly([item.id]);
      return;
    }
    if (this.inFlight.has(item.wamid)) return;
    // The failed head is back: from here the customer's messages run again, in order.
    if (this.failedHead.get(item.from)?.wamid === item.wamid) this.failedHead.delete(item.from);
    this.inFlight.add(item.wamid);
    if (!this.lanes.has(item.from) && this.lanes.size >= this.maxInFlight) {
      this.pending.push(item);
      return;
    }
    this.startOnLane(item);
  }

  startOnLane(item) {
    const previous = this.lanes.get(item.from) ?? Promise.resolve();
    const lane = previous.then(() => this.process(item));
    this.lanes.set(item.from, lane);
    void lane.finally(() => {
      if (this.lanes.get(item.from) === lane) this.lanes.delete(item.from);
      this.drainPending();
    });
  }

  drainPending() {
    while (this.pending.length > 0 && this.lanes.size < this.maxInFlight) {
      this.startOnLane(this.pending.shift());
    }
  }

  async process(item) {
    // Behind a failed message of the same customer nothing runs: order matters more than speed.
    if (this.laneHeld(item.from)) {
      this.inFlight.delete(item.wamid);
      return;
    }
    const turn = Promise.resolve().then(() => this.handle({ ...item, text: describeInbound(item.message) }));
    try {
      await withTimeout(turn, this.handleTimeoutMs, item.wamid);
      this.remember(item.wamid);
      this.inFlight.delete(item.wamid);
      await this.ackQuietly([item.id]);
    } catch (err) {
      // Left unacked on purpose: the lease expires and the orchestrator redelivers.
      this.failedHead.set(item.from, { wamid: item.wamid, at: Date.now() });
      this.log?.warn?.(`whatsapp cloud inbound ${item.wamid} failed: ${errorLabel(err)}`);
      if (err instanceof TurnTimeout) this.watchLateTurn(item, turn);
      else this.inFlight.delete(item.wamid);
    }
  }

  // Still running past its timeout: stays in flight (no double answer), a late finish is acked, a second timeout abandons it.
  watchLateTurn(item, turn) {
    const abandon = setTimeout(() => this.inFlight.delete(item.wamid), this.handleTimeoutMs);
    abandon.unref?.();
    void turn.then(
      () => {
        clearTimeout(abandon);
        this.remember(item.wamid);
        this.inFlight.delete(item.wamid);
        if (this.failedHead.get(item.from)?.wamid === item.wamid) this.failedHead.delete(item.from);
        return this.ackQuietly([item.id]);
      },
      () => {
        clearTimeout(abandon);
        this.inFlight.delete(item.wamid);
      },
    );
  }

  // A hold the orchestrator never redelivers (the row was dropped) would silence the customer for good.
  laneHeld(from) {
    const head = this.failedHead.get(from);
    if (!head) return false;
    if (Date.now() - head.at <= this.handleTimeoutMs) return true;
    this.failedHead.delete(from);
    return false;
  }

  async waitForRoom(signal) {
    while (!signal.aborted && this.lanes.size >= this.maxInFlight) {
      const lanes = [...this.lanes.values()].map((lane) => lane.catch(() => {}));
      const aborted = abortPromise(signal);
      try {
        await Promise.race([...lanes, aborted.promise]);
      } finally {
        aborted.dispose();
      }
    }
  }

  remember(wamid) {
    this.seen.add(wamid);
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next().value;
      this.seen.delete(oldest);
    }
  }

  async ackQuietly(ids) {
    try {
      await this.relay.ack(ids);
    } catch (err) {
      this.log?.warn?.(`whatsapp cloud ack failed: ${errorLabel(err)}`);
    }
  }
}

function withTimeout(promise, ms, wamid) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TurnTimeout(wamid, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function abortPromise(signal) {
  let listener;
  const promise = new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    listener = () => resolve();
    signal.addEventListener("abort", listener, { once: true });
  });
  return { promise, dispose: () => listener && signal.removeEventListener("abort", listener) };
}

function grace(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AutoRestarter,
  AUTO_RESTART_EVENTS,
  type SystemRestartOutcome,
} from "../src/services/auto-restarter.js";
import type { LivenessReport, LivenessSample } from "../src/services/health-monitor.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const CONFIG = {
  failureThreshold: 3,
  cooldownMs: 600_000,
  maxRestartsPerWindow: 3,
  windowMs: 3_600_000,
};

interface Recorded {
  instanceId: string;
  eventType: string;
  payload: Record<string, unknown> | undefined;
}

function harness(
  options: {
    restart?: (id: string) => Promise<SystemRestartOutcome>;
    append?: () => Promise<void>;
    config?: typeof CONFIG;
  } = {},
) {
  const restarts: string[] = [];
  const events: Recorded[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const clock = { now: 1_000_000 };

  const manager = {
    restartBySystem: async (id: string): Promise<SystemRestartOutcome> => {
      restarts.push(id);
      return options.restart ? options.restart(id) : { restarted: true };
    },
  };
  const eventLog = {
    append: async (instanceId: string, eventType: string, opts?: { payload?: Record<string, unknown> }) => {
      await options.append?.();
      events.push({ instanceId, eventType, payload: opts?.payload });
    },
  };
  const logger = {
    info: (_ctx: unknown, msg?: string) => {
      if (typeof _ctx === "string") infos.push(_ctx);
      else if (msg) infos.push(msg);
    },
    warn: (_ctx: unknown, msg?: string) => {
      if (msg) warnings.push(msg);
    },
    error: (_ctx: unknown, msg?: string) => {
      if (msg) errors.push(msg);
    },
  } as never;

  const restarter = new AutoRestarter(manager, eventLog, logger, options.config ?? CONFIG, () => clock.now);
  const inst = makeInstance([]);
  const report = (sample: LivenessSample, instance: Instance = inst): LivenessReport[] => [
    { instance, sample },
  ];
  const observe = async (sample: LivenessSample, times = 1) => {
    for (let i = 0; i < times; i++) {
      restarter.observe(report(sample));
      await restarter.settle();
    }
  };
  return { restarter, inst, report, observe, restarts, events, errors, warnings, infos, clock };
}

test("restarts once the failure threshold is reached, not before", async () => {
  const h = harness();

  await h.observe("down", 2);
  assert.deepEqual(h.restarts, []);

  await h.observe("down");
  assert.deepEqual(h.restarts, [h.inst.id]);
  assert.deepEqual(h.events.map((e) => e.eventType), [AUTO_RESTART_EVENTS.restarted]);
  assert.deepEqual(h.events[0]?.payload, { consecutiveFailures: 3, restartsInWindow: 1 });
});

test("a live sample resets the failure count", async () => {
  const h = harness();

  await h.observe("down", 2);
  await h.observe("live");
  await h.observe("down", 2);

  assert.deepEqual(h.restarts, []);
});

test("booting and unknown samples neither count nor reset", async () => {
  const h = harness();

  await h.observe("down", 2);
  await h.observe("booting");
  await h.observe("unknown");
  assert.deepEqual(h.restarts, []);

  await h.observe("down");
  assert.deepEqual(h.restarts, [h.inst.id]);
});

test("no second restart inside the cooldown, even while the bot stays down", async () => {
  const h = harness();

  await h.observe("down", 3);
  h.clock.now += CONFIG.cooldownMs - 1;
  await h.observe("down", 6);
  assert.equal(h.restarts.length, 1);

  h.clock.now += 1;
  await h.observe("down");
  assert.equal(h.restarts.length, 2);
});

test("the window budget stops restarts and reports exhaustion once", async () => {
  const h = harness();

  for (let i = 0; i < CONFIG.maxRestartsPerWindow; i++) {
    await h.observe("down", 3);
    h.clock.now += CONFIG.cooldownMs;
  }
  assert.equal(h.restarts.length, 3);

  await h.observe("down", 3);
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 3);
  assert.equal(h.events.filter((e) => e.eventType === AUTO_RESTART_EVENTS.exhausted).length, 1);
  assert.deepEqual(h.errors, ["auto restart budget exhausted; bot needs manual attention"]);
});

test("budget frees up once the window has passed", async () => {
  const h = harness();

  for (let i = 0; i < CONFIG.maxRestartsPerWindow; i++) {
    await h.observe("down", 3);
    h.clock.now += CONFIG.cooldownMs;
  }
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 3);

  h.clock.now += CONFIG.windowMs;
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 4);
  assert.equal(h.events.filter((e) => e.eventType === AUTO_RESTART_EVENTS.exhausted).length, 1);
});

test("a restart the manager declined for a passing reason spends no budget", async () => {
  const h = harness({ restart: async () => ({ restarted: false, reason: "gateway answered", transient: true }) });

  await h.observe("down", 3);
  await h.observe("down", 3);

  assert.equal(h.restarts.length, 2, "asked again after the failure count rebuilt");
  assert.deepEqual(h.events, []);
  assert.ok(h.infos.includes("auto restart skipped"));
});

test("a restart the system cannot perform spends budget and ends in the exhausted alert", async () => {
  const h = harness({
    restart: async () => ({ restarted: false, reason: "container is on another image", transient: false }),
  });

  await h.observe("down", 3);
  assert.deepEqual(h.warnings, ["gateway unresponsive; restarting bot", "auto restart blocked"]);
  assert.deepEqual(h.events.map((e) => e.eventType), [AUTO_RESTART_EVENTS.blocked]);
  assert.equal(h.events[0]?.payload?.reason, "container is on another image");

  h.clock.now += CONFIG.cooldownMs - 1;
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 1, "not asked again inside the cooldown");

  for (let i = 1; i <= CONFIG.maxRestartsPerWindow; i++) {
    h.clock.now += CONFIG.cooldownMs;
    await h.observe("down", 3);
  }
  assert.equal(h.restarts.length, CONFIG.maxRestartsPerWindow);
  assert.deepEqual(h.events.map((e) => e.eventType).slice(-1), [AUTO_RESTART_EVENTS.exhausted]);
  assert.equal(h.events.filter((e) => e.eventType === AUTO_RESTART_EVENTS.blocked).length, 3);
  assert.deepEqual(h.errors, ["auto restart budget exhausted; bot needs manual attention"]);
});

test("the cooldown holds even when it is longer than the budget window", async () => {
  const h = harness({ config: { ...CONFIG, cooldownMs: 2 * CONFIG.windowMs } });

  await h.observe("down", 3);
  h.clock.now += CONFIG.windowMs + 1;
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 1);

  h.clock.now += CONFIG.windowMs;
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 2);
});

test("a failed restart is recorded, spends budget and does not throw", async () => {
  const h = harness({
    restart: async () => {
      throw new Error("docker is away");
    },
  });

  await h.observe("down", 3);

  assert.deepEqual(h.events.map((e) => e.eventType), [AUTO_RESTART_EVENTS.failed]);
  assert.equal(h.events[0]?.payload?.error, "docker is away");
  assert.deepEqual(h.errors, ["auto restart failed"]);

  h.clock.now += CONFIG.cooldownMs - 1;
  await h.observe("down", 3);
  assert.equal(h.restarts.length, 1, "cooldown applies after a failed attempt too");
});

test("an event log outage is logged, never propagated", async () => {
  const h = harness({
    append: async () => {
      throw new Error("db down");
    },
  });

  await h.observe("down", 3);

  assert.deepEqual(h.restarts, [h.inst.id]);
  assert.ok(h.warnings.includes("auto restart event not recorded"));
});

test("observe returns before the restart finishes and ignores samples meanwhile", async () => {
  let release!: () => void;
  const gate = new Promise<SystemRestartOutcome>((resolve) => {
    release = () => resolve({ restarted: true });
  });
  const h = harness({ restart: () => gate });

  await h.observe("down", 2);
  h.restarter.observe(h.report("down"));
  h.restarter.observe(h.report("down"));
  h.restarter.observe(h.report("down"));
  h.restarter.observe(h.report("down"));
  assert.equal(h.restarts.length, 1);

  release();
  await h.restarter.settle();
  assert.equal(h.restarts.length, 1);
});

test("most of the fleet failing at once suspends restarts instead of restarting everyone", async () => {
  const h = harness();
  const bots = ["a", "b", "c", "d"].map((id) => makeInstance([], { id }));
  const fleet = (samples: LivenessSample[]): LivenessReport[] =>
    bots.map((instance, i) => ({ instance, sample: samples[i]! }));

  for (let i = 0; i < 3; i++) h.restarter.observe(fleet(["down", "down", "down", "live"]));
  await h.restarter.settle();
  assert.deepEqual(h.restarts, []);
  assert.deepEqual(h.errors, ["most bots failed liveness at once; auto restart suspended"]);

  // One bot still down once the outage clears is a hang again.
  for (let i = 0; i < 3; i++) h.restarter.observe(fleet(["down", "live", "live", "live"]));
  await h.restarter.settle();
  assert.deepEqual(h.restarts, ["a"]);
  assert.ok(h.infos.includes("fleet liveness recovered; auto restart resumed"));
});

test("exactly half the fleet down is still judged per bot", async () => {
  const h = harness();
  const bots = ["a", "b", "c", "d", "e", "f"].map((id) => makeInstance([], { id }));
  const samples: LivenessSample[] = ["down", "down", "down", "live", "live", "live"];

  for (let i = 0; i < 3; i++) {
    h.restarter.observe(bots.map((instance, j) => ({ instance, sample: samples[j]! })));
  }
  await h.restarter.settle();

  assert.deepEqual(h.restarts, ["a", "b", "c"]);
  assert.deepEqual(h.errors, []);
});

test("settle gives up after its deadline while the restart keeps running", async () => {
  const h = harness({ restart: () => new Promise<SystemRestartOutcome>(() => {}) });

  await h.observe("down", 2);
  h.restarter.observe(h.report("down"));
  const started = Date.now();
  await h.restarter.settle(20);

  assert.ok(Date.now() - started < 1_000);
  assert.equal(h.restarts.length, 1);
});

test("bots that left the active set are forgotten", async () => {
  const h = harness();

  await h.observe("down", 2);
  h.restarter.observe([]);
  await h.observe("down", 2);

  assert.deepEqual(h.restarts, []);
});

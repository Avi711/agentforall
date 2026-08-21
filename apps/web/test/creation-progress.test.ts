import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IN_STEP_CAP,
  buildTimeline,
  creationSteps,
  mergeHistory,
  resolvePercent,
} from "../src/lib/bots/creation-progress";

test("mergeHistory never drops a known stage and keeps ascending order", () => {
  const known = [
    { stage: "reserved" as const, at: 10 },
    { stage: "container_created" as const, at: 20 },
  ];
  assert.deepEqual(mergeHistory(known, []), known);
  assert.deepEqual(
    mergeHistory(known, [{ stage: "running", at: 40 }, { stage: "started", at: 30 }]).map((e) => e.stage),
    ["reserved", "container_created", "started", "running"],
  );
  assert.deepEqual(mergeHistory([], known), known);
});

test("step weights sum to 100 for both flows", () => {
  for (const restoring of [false, true]) {
    const total = creationSteps(restoring).reduce((sum, s) => sum + s.weight, 0);
    assert.equal(total, 100, `restoring=${restoring}`);
  }
});

test("percent is monotonic within a step and never passes the step ceiling", () => {
  const steps = creationSteps(false);
  let last = -1;
  for (let seconds = 0; seconds <= 600; seconds += 5) {
    const value = resolvePercent(steps, 1, seconds, null);
    assert.ok(value >= last, `went backwards at ${seconds}s`);
    last = value;
  }
  const ceiling = steps[0].weight + steps[1].weight * IN_STEP_CAP;
  assert.ok(last <= Math.round(ceiling));
  assert.equal(resolvePercent(steps, 0, 0, null), 0);
  assert.equal(resolvePercent(steps, -1, 10, null), 0);
});

test("upload step uses the real byte percentage, clamped", () => {
  const steps = creationSteps(true);
  assert.equal(resolvePercent(steps, 0, 999, 0), 0);
  assert.equal(resolvePercent(steps, 0, 0, 50), Math.round(steps[0].weight * 0.5));
  assert.equal(resolvePercent(steps, 0, 0, 250), Math.round(steps[0].weight * IN_STEP_CAP));
});

test("timeline: server stages bound the container steps exactly", () => {
  const local = [{ id: "registering" as const, startedAt: 1_000, endedAt: 3_000 }];
  const history = [
    { stage: "reserved" as const, at: 2_900 },
    { stage: "container_created" as const, at: 6_800 },
    { stage: "started" as const, at: 9_000 },
  ];
  const timeline = buildTimeline({ local, history, rowKnownAt: 3_000, readyAt: null });
  assert.deepEqual(timeline, [
    { id: "registering", startedAt: 1_000, endedAt: 3_000 },
    { id: "booting", startedAt: 2_900, endedAt: 6_800 },
    { id: "starting", startedAt: 6_800, endedAt: 9_000 },
    { id: "healthcheck", startedAt: 9_000, endedAt: null },
  ]);
});

test("timeline: a late poll that skipped a stage still yields every step", () => {
  const timeline = buildTimeline({
    local: [{ id: "registering", startedAt: 0, endedAt: 3_000 }],
    history: [
      { stage: "reserved", at: 2_900 },
      { stage: "container_created", at: 6_800 },
      { stage: "started", at: 9_000 },
      { stage: "running", at: 25_000 },
    ],
    rowKnownAt: 3_000,
    readyAt: null,
  });
  assert.deepEqual(
    timeline.map((t) => [t.id, t.endedAt]),
    [["registering", 3_000], ["booting", 6_800], ["starting", 9_000], ["healthcheck", 25_000]],
  );
});

test("timeline: before any server stage only the local steps exist; ready closes the last step", () => {
  assert.deepEqual(
    buildTimeline({ local: [{ id: "uploading", startedAt: 0, endedAt: null }], history: [], rowKnownAt: null, readyAt: null }),
    [{ id: "uploading", startedAt: 0, endedAt: null }],
  );
  const ready = buildTimeline({
    local: [],
    history: [{ stage: "reserved", at: 10 }, { stage: "container_created", at: 20 }, { stage: "started", at: 30 }],
    rowKnownAt: null,
    readyAt: 50,
  });
  assert.equal(ready.at(-1)?.endedAt, 50);
});

test("timeline: reload with no reserve event falls back to the client row time", () => {
  const timeline = buildTimeline({
    local: [],
    history: [{ stage: "container_created", at: 500 }],
    rowKnownAt: 100,
    readyAt: null,
  });
  assert.deepEqual(timeline.map((t) => [t.id, t.startedAt, t.endedAt]), [
    ["booting", 100, 500],
    ["starting", 500, null],
  ]);
});

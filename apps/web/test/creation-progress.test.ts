import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IN_STEP_CAP,
  creationSteps,
  isLaterStep,
  resolvePercent,
  stepForStage,
  timelineForStage,
} from "../src/lib/bots/creation-progress";

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

test("orchestrator stages map onto client steps and reload timelines", () => {
  assert.equal(stepForStage("reserved"), null);
  assert.equal(stepForStage("container_created"), "starting");
  assert.equal(stepForStage("backup_restored"), "starting");
  assert.equal(stepForStage("started"), "healthcheck");
  assert.equal(stepForStage(null), null);
  assert.deepEqual(
    timelineForStage("started").map((t) => t.id),
    ["registering", "booting", "starting", "healthcheck"],
  );
  assert.deepEqual(timelineForStage(undefined).map((t) => t.id), ["registering", "booting"]);
  assert.ok(isLaterStep("healthcheck", "starting"));
  assert.ok(!isLaterStep("booting", "starting"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { InstanceOperationLock } from "../src/services/instance-operation-lock.js";

test("instance operation lock serializes same instance and allows different instances", async () => {
  const lock = new InstanceOperationLock();
  const events: string[] = [];
  let releaseFirst!: () => void;
  let first!: Promise<void>;
  const firstStarted = new Promise<void>((resolve) => {
    first = lock.run("a", async () => {
      events.push("a1-start");
      resolve();
      await new Promise<void>((release) => {
        releaseFirst = release;
      });
      events.push("a1-end");
    });
  });

  await firstStarted;
  const second = lock.run("a", async () => {
    events.push("a2");
  });
  await lock.run("b", async () => {
    events.push("b1");
  });

  assert.deepEqual(events, ["a1-start", "b1"]);
  releaseFirst();
  await second;
  await first;
  assert.deepEqual(events, ["a1-start", "b1", "a1-end", "a2"]);
});

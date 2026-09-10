import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyQueue } from "./reply-queue.js";

test("a flush sends in order and forgets the message once every chunk went out", async () => {
  const queue = new ReplyQueue();
  const sent = [];
  queue.add("w1", [{ text: "a" }, { text: "b" }]);

  await queue.flush("w1", async (send) => sent.push(send.text));

  assert.deepEqual(sent, ["a", "b"]);
  assert.equal(queue.has("w1"), false);
});

test("a failure keeps the chunk that failed and everything behind it for the next attempt", async () => {
  const queue = new ReplyQueue();
  const sent = [];
  queue.add("w1", [{ text: "a" }, { text: "b" }, { text: "c" }]);

  await assert.rejects(
    queue.flush("w1", async (send) => {
      if (send.text === "b") throw new Error("503");
      sent.push(send.text);
    }),
  );
  assert.equal(queue.has("w1"), true);
  await queue.flush("w1", async (send) => sent.push(send.text));

  assert.deepEqual(sent, ["a", "b", "c"]);
  assert.equal(queue.has("w1"), false);
});

test("the queue is bounded: the oldest message is forgotten first", () => {
  const queue = new ReplyQueue(2);
  queue.add("w1", [{ text: "a" }]);
  queue.add("w2", [{ text: "b" }]);
  queue.add("w3", [{ text: "c" }]);

  assert.equal(queue.has("w1"), false);
  assert.equal(queue.has("w2"), true);
  assert.equal(queue.has("w3"), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, truncateUnits } from "./outbound-text.js";

test("short text is one chunk; long text splits on paragraph or sentence boundaries under the limit", () => {
  assert.deepEqual(chunkText("שלום"), ["שלום"]);
  const paragraph = "משפט אחד. ".repeat(30).trim();
  const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
  const chunks = chunkText(text, 400);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) assert.ok(Array.from(chunk).length <= 400);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("chunks are measured in UTF-16 units like the relay's limit, and an emoji is never split in half", () => {
  const emoji = "👍".repeat(10);
  assert.deepEqual(chunkText(emoji, 4), ["👍👍", "👍👍", "👍👍", "👍👍", "👍👍"]);
  assert.deepEqual(chunkText(emoji, 5), ["👍👍", "👍👍", "👍👍", "👍👍", "👍👍"]);
  for (const chunk of chunkText("x".repeat(4095) + "👍".repeat(3))) assert.ok(chunk.length <= 4096);
  const wall = "a".repeat(9000);
  assert.deepEqual(chunkText(wall).map((c) => c.length), [4096, 4096, 808]);
});

test("a window of whitespace produces no empty chunk", () => {
  const chunks = chunkText(`${"a".repeat(10)}${" ".repeat(30)}b`, 15);
  assert.deepEqual(chunks, ["a".repeat(10), "b"]);
});

test("truncation keeps a surrogate pair whole", () => {
  assert.equal(truncateUnits("abc", 10), "abc");
  assert.equal(truncateUnits("ab👍cd", 3), "ab");
  assert.equal(truncateUnits("ab👍cd", 4), "ab👍");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../src/lib/http/json-body";

const post = (body?: string) => new Request("https://x.test/api", { method: "POST", body });

test("an empty or missing body reads as undefined, so optional bodies can be left out", async () => {
  assert.deepEqual(await readJsonBody(post()), { ok: true, value: undefined });
  assert.deepEqual(await readJsonBody(post("")), { ok: true, value: undefined });
  assert.deepEqual(await readJsonBody(new Request("https://x.test/api")), { ok: true, value: undefined });
});

test("JSON is parsed, and malformed JSON is refused rather than read as empty", async () => {
  assert.deepEqual(await readJsonBody(post('{"label":"עבודה"}')), { ok: true, value: { label: "עבודה" } });
  assert.deepEqual(await readJsonBody(post("null")), { ok: true, value: null });
  assert.deepEqual(await readJsonBody(post("{nope")), { ok: false });
});

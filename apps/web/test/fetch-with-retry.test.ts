import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "../src/lib/http/fetch-with-retry";

const realFetch = globalThis.fetch;
const OPTIONS = { attempts: 3, timeoutMs: 1000, backoffMs: 0 };

function stubFetch(answers: Array<number | Error>) {
  let calls = 0;
  globalThis.fetch = (async () => {
    const answer = answers[Math.min(calls++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return new Response(null, { status: answer });
  }) as typeof fetch;
  return () => calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a success returns at once", async () => {
  const calls = stubFetch([200]);
  assert.equal((await fetchWithRetry("https://x.test", {}, OPTIONS)).status, 200);
  assert.equal(calls(), 1);
});

test("429, 5xx and network errors are retried until one succeeds", async () => {
  const calls = stubFetch([429, new Error("reset"), 200]);
  assert.equal((await fetchWithRetry("https://x.test", {}, OPTIONS)).status, 200);
  assert.equal(calls(), 3);
});

test("a 4xx other than 429 is final", async () => {
  const calls = stubFetch([400, 200]);
  assert.equal((await fetchWithRetry("https://x.test", {}, OPTIONS)).status, 400);
  assert.equal(calls(), 1);
});

test("the last retryable answer is returned once attempts run out", async () => {
  const calls = stubFetch([503]);
  assert.equal((await fetchWithRetry("https://x.test", {}, OPTIONS)).status, 503);
  assert.equal(calls(), 3);
});

test("a network error on the last attempt is thrown", async () => {
  stubFetch([new Error("down")]);
  await assert.rejects(fetchWithRetry("https://x.test", {}, OPTIONS), /down/);
});

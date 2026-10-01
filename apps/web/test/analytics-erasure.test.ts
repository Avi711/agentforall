import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { eraseAnalyticsPerson } from "../src/lib/analytics/erasure";

interface Call {
  url: string;
  auth: string | null;
  body: unknown;
}

function fakeFetch(answer: () => Response) {
  const calls: Call[] = [];
  const send: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return answer();
  };
  return { send, calls };
}

function captureErrors(t: TestContext) {
  return t.mock.method(console, "error", () => {}).mock;
}

test("asks PostHog to delete the person with their events and recordings", async (t) => {
  const errors = captureErrors(t);
  const { send, calls } = fakeFetch(() => Response.json({ persons_found: 1, persons_queued_for_deletion: 1 }, { status: 202 }));

  await eraseAnalyticsPerson("user-1", "phx_key", send);

  assert.deepEqual(calls, [
    {
      url: "https://eu.posthog.com/api/projects/289867/persons/bulk_delete/",
      auth: "Bearer phx_key",
      body: { distinct_ids: ["user-1"], delete_events: true, delete_recordings: true },
    },
  ]);
  assert.equal(errors.callCount(), 0);
});

test("every miss is logged with the user id for a manual delete, and never throws", async (t) => {
  const answers: Array<[string, () => Response]> = [
    ["refused", () => new Response("forbidden", { status: 403 })],
    ["incomplete", () => Response.json({ persons_found: 1, deletion_errors: [{ person_uuid: "p1", step: "events" }] }, { status: 202 })],
    ["unreadable", () => new Response("not json", { status: 202 })],
  ];
  for (const [label, answer] of answers) {
    const errors = captureErrors(t);
    await eraseAnalyticsPerson("user-1", "phx_key", fakeFetch(answer).send);
    assert.equal(errors.callCount(), 1, label);
    assert.match(JSON.stringify(errors.calls[0]?.arguments), /"userId":"user-1"/, label);
    errors.resetCalls();
  }
});

test("without the key nothing is sent and the id is logged", async (t) => {
  const errors = captureErrors(t);
  const { send, calls } = fakeFetch(() => Response.json({}));

  await eraseAnalyticsPerson("user-1", undefined, send);

  assert.deepEqual(calls, []);
  assert.match(JSON.stringify(errors.calls[0]?.arguments), /"userId":"user-1"/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayClient, RelayError, errorLabel } from "./relay-client.js";

function fakeFetch(responder) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    return responder(seen.at(-1));
  };
  return { seen, fetchImpl };
}

const json = (status, body) => new Response(JSON.stringify(body), { status });

test("every call carries the bearer and targets the bot's relay base", async () => {
  const { seen, fetchImpl } = fakeFetch(() => json(200, { items: [{ id: "1", wamid: "w1" }] }));
  const relay = new RelayClient({ baseUrl: "http://orchestrator:3000/api/v1/whatsapp-cloud/bot-1/", token: "t0k", fetchImpl });

  const items = await relay.pull(25_000);

  assert.equal(items[0].wamid, "w1");
  assert.equal(seen[0].url, "http://orchestrator:3000/api/v1/whatsapp-cloud/bot-1/inbox?wait=25000");
  assert.equal(seen[0].auth, "Bearer t0k");
});

test("send, ack, read and handoff post the shapes the orchestrator validates", async () => {
  const { seen, fetchImpl } = fakeFetch((req) => {
    if (req.url.endsWith("/send")) return json(201, { wamid: "wamid.9" });
    if (req.url.endsWith("/ack")) return json(200, { acked: 2 });
    if (req.url.endsWith("/mode")) return json(200, { conversation: { waId: "972501234567", mode: "human" } });
    if (req.url.endsWith("/escalate")) return json(200, { notified: false });
    return new Response(null, { status: 204 });
  });
  const relay = new RelayClient({ baseUrl: "http://o/api/v1/whatsapp-cloud/b", token: "t", fetchImpl });

  assert.equal(await relay.sendText({ to: "972501234567", text: "שלום", replyToId: "w0", kind: "reply" }), "wamid.9");
  assert.deepEqual(seen[0].body, { to: "972501234567", text: "שלום", replyToId: "w0", kind: "reply" });
  assert.equal(await relay.ack(["1", "2"]), 2);
  await relay.markRead("w1", true);
  assert.deepEqual(seen[2].body, { wamid: "w1", typing: true });
  const conversation = await relay.setMode("972501234567", "human");
  assert.equal(conversation.mode, "human");
  assert.equal(seen[3].url, "http://o/api/v1/whatsapp-cloud/b/conversations/972501234567/mode");
  assert.deepEqual(await relay.escalate("972501234567", "help"), { notified: false, fallbackToBot: false });
  assert.deepEqual(seen[4].body, { waId: "972501234567", summary: "help", kind: "request" });
});

test("orchestrator errors surface with their status and domain code", async () => {
  const { fetchImpl } = fakeFetch(() => json(409, { code: "CUSTOMER_WINDOW_CLOSED", message: "closed" }));
  const relay = new RelayClient({ baseUrl: "http://o/x", token: "t", fetchImpl });

  await assert.rejects(relay.sendText({ to: "972501234567", text: "x" }), (err) => {
    assert.ok(err instanceof RelayError);
    assert.equal(err.status, 409);
    assert.equal(err.code, "CUSTOMER_WINDOW_CLOSED");
    return true;
  });
});

test("the client refuses to start without its credentials", () => {
  assert.throws(() => new RelayClient({ baseUrl: "http://o", token: "" }));
  assert.throws(() => new RelayClient({ baseUrl: "", token: "t" }));
});

test("a 2xx without the expected body is a typed error, never a crash on null", async () => {
  const { fetchImpl } = fakeFetch(() => new Response(null, { status: 204 }));
  const relay = new RelayClient({ baseUrl: "http://o/x", token: "t", fetchImpl });

  await assert.rejects(relay.sendText({ to: "972501234567", text: "x" }), (err) => {
    assert.ok(err instanceof RelayError);
    assert.equal(err.code, "EMPTY_RESPONSE");
    return true;
  });
  await assert.rejects(relay.setMode("972501234567", "human"), RelayError);
  assert.deepEqual(await relay.pull(1), []);
  assert.equal(await relay.ack(["1"]), 0);
});

test("a relay error is logged by status and code only, so an orchestrator message never leaks a number", () => {
  assert.equal(errorLabel(new RelayError(404, "NOT_FOUND", "conversation 972501234567 not found")), "relay 404 NOT_FOUND");
  assert.equal(errorLabel(new Error("timed out")), "timed out");
});

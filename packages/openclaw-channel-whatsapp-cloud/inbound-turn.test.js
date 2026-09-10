import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayError } from "./relay-client.js";
import { ReplyQueue } from "./reply-queue.js";
import { handleInbound, isRetryableDelivery } from "./inbound-turn.js";

const silent = { warn() {}, info() {} };
const item = (text = "hi") => ({ id: "1", wamid: "wamid.1", from: "972501234567", profileName: "Dana", timestamp: "2026-09-10T08:00:00.000Z", text });

function fakeRelay({ mode = "bot", sendFailures = [] } = {}) {
  const sent = [];
  const escalations = [];
  const relay = {
    conversation: async () => ({ mode }),
    markRead: async () => {},
    sendText: async (send) => {
      const failure = sendFailures.shift();
      if (failure) throw failure;
      sent.push(send);
      return `wamid.out${sent.length}`;
    },
    escalate: async (waId, summary, kind) => {
      escalations.push({ waId, summary, kind });
      return { notified: true, fallbackToBot: false };
    },
  };
  return { relay, sent, escalations };
}

function turn({ replyTo, texts = ["שלום"] } = {}) {
  const calls = [];
  const dispatch = async (params) => {
    calls.push(params);
    for (const text of texts) await params.deliver({ text, replyToId: replyTo ?? params.messageId });
  };
  return { dispatch, calls };
}

const base = (relay, replies, dispatch) => ({ cfg: {}, account: { accountId: "default", phoneNumberId: "2000" }, relay, log: silent, replies, dispatch, runtime: {} });

test("a reply quotes only the customer's own message; anything else the model names is sent unquoted", async () => {
  const { relay, sent } = fakeRelay();
  const replies = new ReplyQueue();
  await handleInbound({ ...base(relay, replies, turn().dispatch), item: item() });
  await handleInbound({ ...base(relay, replies, turn({ replyTo: "wamid.other" }).dispatch), item: { ...item(), wamid: "wamid.2", id: "2" } });

  assert.equal(sent[0]?.replyToId, "wamid.1");
  assert.equal(sent[1]?.replyToId, undefined);
});

test("a relay 503 mid-reply fails the turn so the row comes back, and the redelivery flushes without a second turn", async () => {
  const { relay, sent } = fakeRelay({ sendFailures: [new RelayError(503, null), new RelayError(503, null)] });
  const replies = new ReplyQueue();
  const t = turn({ texts: ["first", "second"] });

  await assert.rejects(handleInbound({ ...base(relay, replies, t.dispatch), item: item() }), /not delivered/);
  assert.equal(replies.has("wamid.1"), true);
  assert.deepEqual(sent, []);

  await handleInbound({ ...base(relay, replies, t.dispatch), item: item() });
  assert.equal(t.calls.length, 1);
  assert.deepEqual(sent.map((s) => s.text), ["first", "second"]);
  assert.equal(replies.has("wamid.1"), false);
});

test("a relay 4xx drops the reply, the turn succeeds and nothing is left queued", async () => {
  const { relay, sent } = fakeRelay({ sendFailures: [new RelayError(400, "VALIDATION_ERROR")] });
  const replies = new ReplyQueue();

  await handleInbound({ ...base(relay, replies, turn().dispatch), item: item() });

  assert.deepEqual(sent, []);
  assert.equal(replies.has("wamid.1"), false);
});

test("human mode forwards the text to the owner and runs no turn; a fallback to the bot runs one", async () => {
  const forwarded = fakeRelay({ mode: "human" });
  const t1 = turn();
  await handleInbound({ ...base(forwarded.relay, new ReplyQueue(), t1.dispatch), item: item("help me") });
  assert.deepEqual(forwarded.escalations, [{ waId: "972501234567", summary: "help me", kind: "forward" }]);
  assert.equal(t1.calls.length, 0);

  const back = fakeRelay({ mode: "human" });
  back.relay.escalate = async () => ({ notified: false, fallbackToBot: true });
  const t2 = turn();
  await handleInbound({ ...base(back.relay, new ReplyQueue(), t2.dispatch), item: item() });
  assert.equal(t2.calls.length, 1);

  const throttled = fakeRelay({ mode: "human" });
  throttled.relay.escalate = async () => ({ notified: false, fallbackToBot: false });
  await assert.rejects(handleInbound({ ...base(throttled.relay, new ReplyQueue(), turn().dispatch), item: item() }), /throttled/);
});

test("delivery failures are retryable unless the relay rejected the message for good", () => {
  assert.equal(isRetryableDelivery(new RelayError(503, null)), true);
  assert.equal(isRetryableDelivery(new RelayError(429, null)), true);
  assert.equal(isRetryableDelivery(new RelayError(0, null)), true);
  assert.equal(isRetryableDelivery(new RelayError(409, "CHANNEL_CREDENTIAL_INVALID")), true);
  assert.equal(isRetryableDelivery(new RelayError(409, "CUSTOMER_WINDOW_CLOSED")), false);
  assert.equal(isRetryableDelivery(new RelayError(409, "CONVERSATION_HELD_BY_OWNER")), false);
  assert.equal(isRetryableDelivery(new RelayError(400, "VALIDATION_ERROR")), false);
  assert.equal(isRetryableDelivery(new Error("network")), true);
});

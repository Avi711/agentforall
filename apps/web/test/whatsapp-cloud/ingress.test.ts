import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { IngressError, WhatsappCloudIngress } from "../../src/lib/whatsapp-cloud/ingress";
import type { InboundRow, WhatsappCloudIngressStore } from "../../src/lib/whatsapp-cloud/repository";

const SECRET = "app-secret";
const VERIFY = "verify-me";
const BOT = "11111111-1111-4111-8111-111111111111";
const silent = { warn() {} };

function fakeStore(numbers: Record<string, string>) {
  const enqueued: InboundRow[][] = [];
  const store: WhatsappCloudIngressStore = {
    findInstanceIdByPhoneNumberId: async (id) => numbers[id] ?? null,
    enqueue: async (rows) => {
      enqueued.push(rows);
      return rows.length;
    },
  };
  return { store, enqueued };
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`;
}

function envelope(messages: unknown[], phoneNumberId = "2000", field = "messages"): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1000",
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "972501112233", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Dana" }, wa_id: "972501234567" }],
              messages,
            },
          },
        ],
      },
    ],
  });
}

const TEXT = { from: "972501234567", id: "wamid.1", timestamp: "1749416383", type: "text", text: { body: "hi" } };
const RECEIVED_AT = new Date("2026-09-10T08:00:00Z");
const clock = () => RECEIVED_AT;

test("the subscription handshake echoes the challenge only for our verify token", () => {
  const ingress = new WhatsappCloudIngress(fakeStore({}).store, SECRET, VERIFY, silent);
  const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "42" });
  assert.equal(ingress.verifyChallenge(ok), "42");

  const wrong = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" });
  assert.throws(() => ingress.verifyChallenge(wrong), (err: unknown) => err instanceof IngressError && err.status === 403);
});

test("a bad or missing signature is rejected before the body is read", async () => {
  const { store, enqueued } = fakeStore({ "2000": BOT });
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, silent);
  const body = envelope([TEXT]);

  await assert.rejects(ingress.handle({ rawBody: body, signature: null }), (err: unknown) => err instanceof IngressError && err.status === 401);
  await assert.rejects(ingress.handle({ rawBody: body, signature: "sha256=00" }), IngressError);
  await assert.rejects(ingress.handle({ rawBody: body, signature: sign(body + " ") }), IngressError);
  assert.equal(enqueued.length, 0);
});

test("a signed message is routed by phone_number_id and stored with Meta's object intact", async () => {
  const { store, enqueued } = fakeStore({ "2000": BOT });
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, silent, clock);
  const body = envelope([TEXT]);

  const outcome = await ingress.handle({ rawBody: body, signature: sign(body) });

  assert.deepEqual(outcome, { received: 1, enqueued: 1, unknownNumbers: 0, rejected: 0 });
  assert.deepEqual(enqueued[0], [
    {
      wamid: "wamid.1",
      instanceId: BOT,
      waId: "972501234567",
      profileName: "Dana",
      waTimestamp: new Date(1749416383 * 1000),
      receivedAt: RECEIVED_AT,
      payload: { from: "972501234567", profileName: "Dana", message: TEXT },
    },
  ]);
});

test("one odd contact or message is skipped and counted; the rest of the batch still lands", async () => {
  const { store, enqueued } = fakeStore({ "2000": BOT });
  const warnings: string[] = [];
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, { warn: (m: string) => warnings.push(m) }, clock);
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1000",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "2000" },
              contacts: [{ wa_id: "not-a-number", profile: { name: "Ghost" } }, { wa_id: "972501234567", profile: { name: "Dana" } }],
              messages: [TEXT, { ...TEXT, id: "wamid.2", timestamp: "not-a-timestamp" }, { ...TEXT, id: "wamid.3" }],
            },
          },
        ],
      },
    ],
  });

  const outcome = await ingress.handle({ rawBody: body, signature: sign(body) });

  assert.deepEqual(outcome, { received: 2, enqueued: 2, unknownNumbers: 0, rejected: 1 });
  assert.deepEqual(enqueued[0]?.map((r) => [r.wamid, r.profileName]), [["wamid.1", "Dana"], ["wamid.3", "Dana"]]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.includes("hi"), false);
});

test("an unknown number is acknowledged and skipped so Meta stops retrying it", async () => {
  const { store, enqueued } = fakeStore({});
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, silent);
  const body = envelope([TEXT], "9999");

  const outcome = await ingress.handle({ rawBody: body, signature: sign(body) });

  assert.deepEqual(outcome, { received: 1, enqueued: 0, unknownNumbers: 1, rejected: 0 });
  assert.deepEqual(enqueued, [[]]);
});

test("status updates and unknown fields are ignored; malformed envelopes are a 400", async () => {
  const { store, enqueued } = fakeStore({ "2000": BOT });
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, silent);

  const statuses = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "1000", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "2000" }, statuses: [{ id: "wamid.1", status: "read" }] } }] }],
  });
  assert.deepEqual(await ingress.handle({ rawBody: statuses, signature: sign(statuses) }), { received: 0, enqueued: 0, unknownNumbers: 0, rejected: 0 });

  const other = envelope([TEXT], "2000", "account_update");
  assert.deepEqual(await ingress.handle({ rawBody: other, signature: sign(other) }), { received: 0, enqueued: 0, unknownNumbers: 0, rejected: 0 });
  assert.deepEqual(enqueued, [[], []]);

  const garbage = "{not json";
  await assert.rejects(ingress.handle({ rawBody: garbage, signature: sign(garbage) }), (err: unknown) => err instanceof IngressError && err.status === 400);
  const wrongObject = JSON.stringify({ object: "page", entry: [] });
  await assert.rejects(ingress.handle({ rawBody: wrongObject, signature: sign(wrongObject) }), (err: unknown) => err instanceof IngressError && err.status === 400);
});

test("a batch for two bots is split by number and each message keeps its sender", async () => {
  const { store, enqueued } = fakeStore({ "2000": BOT, "3000": "22222222-2222-4222-8222-222222222222" });
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, silent);
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      { id: "a", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "2000" }, messages: [TEXT] } }] },
      { id: "b", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "3000" }, messages: [{ ...TEXT, id: "wamid.2", from: "972509999999" }] } }] },
    ],
  });

  const outcome = await ingress.handle({ rawBody: body, signature: sign(body) });

  assert.equal(outcome.enqueued, 2);
  assert.deepEqual(enqueued[0]?.map((r) => [r.instanceId, r.waId, r.profileName]), [
    [BOT, "972501234567", null],
    ["22222222-2222-4222-8222-222222222222", "972509999999", null],
  ]);
});

test("a NUL in one message is stripped so the batch can still be stored; a literal backslash-u text is untouched", async () => {
  const { store, enqueued } = fakeStore({ "2000": BOT });
  const ingress = new WhatsappCloudIngress(store, SECRET, VERIFY, silent, clock);
  const body = envelope([{ ...TEXT, text: { body: "hi\u0000there" } }, { ...TEXT, id: "wamid.2", text: { body: "a\\u0000b" } }]);

  const outcome = await ingress.handle({ rawBody: body, signature: sign(body) });

  assert.equal(outcome.enqueued, 2);
  const bodies = enqueued[0]?.map((row) => (row.payload.message as { text: { body: string } }).text.body);
  assert.deepEqual(bodies, ["hithere", "a\\u0000b"]);
});

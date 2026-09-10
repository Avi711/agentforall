import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { FastifyBaseLogger } from "fastify";
import { WhatsappCloudInboxListener } from "../src/storage/whatsapp-cloud-listener.js";

// Runs only against a throwaway Postgres (see docs/whatsapp-cloud-api.md §11).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL not set";
if (url && /supabase|prod/i.test(url)) throw new Error("refusing to run the DB test against what looks like production");

const silentLog = { warn() {}, info() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;

test("a real LISTEN connection wakes for a notification sent from another connection, ignores other channels, and stops cleanly", { skip }, async () => {
  const woke: string[] = [];
  const listener = WhatsappCloudInboxListener.forUrl(url!, (id) => woke.push(id), silentLog);
  await listener.start();
  assert.equal(listener.connected, true);
  const sender = new Client({ connectionString: url });
  await sender.connect();
  try {
    await sender.query("select pg_notify('whatsapp_cloud_inbox', $1)", ["bot-1"]);
    await sender.query("select pg_notify('some_other_channel', $1)", ["bot-2"]);
    const deadline = Date.now() + 2_000;
    while (woke.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(woke, ["bot-1"]);
  } finally {
    await sender.end();
    await listener.stop();
  }
  assert.equal(listener.connected, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { WhatsappCloudInboxListener, type ListenClient } from "../src/storage/whatsapp-cloud-listener.js";

const silentLog = { warn() {}, info() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;

type Handler = (arg?: never) => void;

function fakeClient(opts: { failConnect?: boolean; connectGate?: Promise<void> } = {}) {
  const handlers = new Map<string, Handler>();
  const queries: string[] = [];
  let ended = 0;
  const client: ListenClient = {
    connect: async () => {
      await opts.connectGate;
      if (opts.failConnect) throw new Error("refused");
    },
    query: async (text) => {
      queries.push(text);
      return undefined;
    },
    end: async () => {
      ended += 1;
    },
    on: (event: string, listener: (...args: never[]) => void) => {
      handlers.set(event, listener as Handler);
    },
  };
  return { client, handlers, queries, ended: () => ended };
}

type Fake = ReturnType<typeof fakeClient>;

function emit(fake: Fake | undefined, event: "error" | "end", err?: Error): void {
  (fake?.handlers.get(event) as ((err?: Error) => void) | undefined)?.(err);
}

function notify(fake: Fake, msg: { channel: string; payload?: string }): void {
  (fake.handlers.get("notification") as ((msg: { channel: string; payload?: string }) => void) | undefined)?.(msg);
}

test("a notification on the inbox channel wakes the dispatcher with the instance id", async () => {
  const woke: string[] = [];
  const fake = fakeClient();
  const listener = new WhatsappCloudInboxListener((id) => woke.push(id), silentLog, () => fake.client);

  await listener.start();
  notify(fake, { channel: "whatsapp_cloud_inbox", payload: "bot-1" });
  notify(fake, { channel: "other", payload: "bot-2" });
  await listener.stop();

  assert.deepEqual(fake.queries, ["LISTEN whatsapp_cloud_inbox"]);
  assert.deepEqual(woke, ["bot-1"]);
  assert.equal(fake.ended(), 1);
});

test("a dropped connection reconnects with a fresh client; stop ends the current one and reconnects no more", async () => {
  const clients: ReturnType<typeof fakeClient>[] = [];
  const listener = new WhatsappCloudInboxListener(() => {}, silentLog, () => {
    const c = fakeClient({ failConnect: clients.length === 1 });
    clients.push(c);
    return c.client;
  });

  await listener.start();
  assert.equal(listener.connected, true);
  emit(clients[0], "error", new Error("gone"));
  assert.equal(listener.connected, false);
  await new Promise((r) => setTimeout(r, 1_100));
  assert.equal(clients.length, 2);
  await new Promise((r) => setTimeout(r, 2_100));
  assert.equal(clients.length, 3);
  assert.equal(listener.connected, true);
  await listener.stop();
  emit(clients[2], "end");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(clients.length, 3);
});

test("a stop during a pending connect closes the client that arrives late and leaves nothing listening", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const fake = fakeClient({ connectGate: gate });
  const listener = new WhatsappCloudInboxListener(() => {}, silentLog, () => fake.client);

  const starting = listener.start();
  await listener.stop();
  open();
  await starting;

  assert.equal(listener.connected, false);
  assert.equal(fake.ended(), 1);
});

test("starting twice opens one connection", async () => {
  const clients: ReturnType<typeof fakeClient>[] = [];
  const listener = new WhatsappCloudInboxListener(() => {}, silentLog, () => {
    const c = fakeClient();
    clients.push(c);
    return c.client;
  });

  await Promise.all([listener.start(), listener.start()]);
  await listener.start();

  assert.equal(clients.length, 1);
  await listener.stop();
});

test("a connection that dies young keeps the longer backoff; one that held resets it", async () => {
  let clock = 0;
  const clients: ReturnType<typeof fakeClient>[] = [];
  const listener = new WhatsappCloudInboxListener(
    () => {},
    silentLog,
    () => {
      const c = fakeClient();
      clients.push(c);
      return c.client;
    },
    () => clock,
  );

  await listener.start();
  clock = 60_000;
  emit(clients[0], "error", new Error("gone"));
  await new Promise((r) => setTimeout(r, 1_100));
  assert.equal(clients.length, 2);
  assert.equal(clients[0]?.ended(), 1);

  emit(clients[1], "error", new Error("gone again"));
  await new Promise((r) => setTimeout(r, 1_100));
  assert.equal(clients.length, 2);
  await new Promise((r) => setTimeout(r, 1_200));
  assert.equal(clients.length, 3);
  await listener.stop();
});

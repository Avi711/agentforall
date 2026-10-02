import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ProductEvent } from "../../src/lib/analytics/events";
import type { BrowserIds } from "../../src/lib/meta-capi/browser";
import type { CapiConfig } from "../../src/lib/meta-capi/config";
import type { CapiSendResult, ServerEvent } from "../../src/lib/meta-capi/client";
import type { MetaIdentity } from "../../src/lib/meta-capi/repository";
import { MetaConversions, type MetaAttributionStore } from "../../src/lib/meta-capi/service";

const CONFIG: CapiConfig = { pixelId: "803144279101703", accessToken: "token", apiVersion: "v26.0" };
const NOW = 1_790_000_000_000;
const USER_ID = "user-1";
const BROWSER: BrowserIds = {
  fbp: "fb.1.1789990000000.1234567890",
  fbc: "fb.1.1789990000000.IwAR2abc",
  clientIp: "2a02:6680:1100::1",
  userAgent: "Mozilla/5.0",
  country: "il",
};
const IDENTITY: MetaIdentity = { email: "Dana@Example.com", name: "דנה כהן", browser: BROWSER };

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function setup(options: { config?: CapiConfig | null; identity?: MetaIdentity | null; store?: Partial<MetaAttributionStore>; result?: CapiSendResult } = {}) {
  const sent: ServerEvent[][] = [];
  const stored: Array<{ userId: string; ids: BrowserIds }> = [];
  const lookups: string[] = [];
  let nextId = 0;
  const conversions = new MetaConversions({
    config: options.config === undefined ? CONFIG : options.config,
    store: {
      remember: async (userId, ids) => {
        stored.push({ userId, ids });
      },
      findIdentity: async (userId) => {
        lookups.push(userId);
        return options.identity === undefined ? IDENTITY : options.identity;
      },
      ...options.store,
    },
    send: async (_config, events) => {
      sent.push(events);
      return options.result ?? { ok: true, eventsReceived: events.length };
    },
    now: () => NOW,
    newEventId: () => `event-${++nextId}`,
  });
  return { conversions, sent, stored, lookups };
}

async function quietly<T>(work: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
  const logged: string[] = [];
  const { error, warn } = console;
  console.error = (...args: unknown[]) => logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  console.warn = console.error;
  try {
    return { result: await work(), logged };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

test("a sign-up reaches Meta as CompleteRegistration with hashed identity and raw browser ids", async () => {
  const { conversions, sent } = setup();

  await conversions.track(USER_ID, { name: "signed_up", method: "google" });

  assert.deepEqual(sent, [
    [
      {
        event_name: "CompleteRegistration",
        event_time: NOW / 1000,
        event_id: "event-1",
        event_source_url: "https://agentforall.co.il/login",
        action_source: "website",
        user_data: {
          em: [sha256("dana@example.com")],
          fn: [sha256("דנה")],
          ln: [sha256("כהן")],
          external_id: [sha256(USER_ID)],
          country: [sha256("il")],
          client_ip_address: BROWSER.clientIp,
          client_user_agent: BROWSER.userAgent,
          fbp: BROWSER.fbp,
          fbc: BROWSER.fbc,
        },
      },
    ],
  ]);
});

test("a first subscription payment is both Subscribe and Purchase, valued in shekels, in one request", async () => {
  const { conversions, sent } = setup();

  await conversions.track(USER_ID, { name: "subscription_paid", plan: "standard", new_subscription: true, amount_agorot: 20000, currency: "ILS" });

  assert.equal(sent.length, 1);
  assert.deepEqual(
    sent[0]?.map((event) => ({ name: event.event_name, id: event.event_id, url: event.event_source_url, data: event.custom_data })),
    [
      { name: "Subscribe", id: "event-1", url: "https://agentforall.co.il/app/billing/return", data: { value: 200, currency: "ILS" } },
      { name: "Purchase", id: "event-2", url: "https://agentforall.co.il/app/billing/return", data: { value: 200, currency: "ILS" } },
    ],
  );
});

test("the funnel steps map to Meta's standard events", async () => {
  const events: ProductEvent[] = [
    { name: "trial_started" },
    { name: "checkout_started", kind: "topup", product: "topup_ils_50", amount_agorot: 5000, currency: "ILS" },
    { name: "credits_purchased", product: "topup_ils_50", amount_agorot: 5000, currency: "ILS" },
  ];
  const { conversions, sent } = setup();

  for (const event of events) await conversions.track(USER_ID, event);

  assert.deepEqual(
    sent.flat().map((event) => [event.event_name, event.custom_data]),
    [
      ["StartTrial", undefined],
      ["InitiateCheckout", { value: 50, currency: "ILS" }],
      ["Purchase", { value: 50, currency: "ILS" }],
    ],
  );
});

test("renewals and bot creation are not ad conversions, so nothing is looked up or sent", async () => {
  const { conversions, sent, lookups } = setup();

  await conversions.track(USER_ID, { name: "subscription_paid", plan: "standard", new_subscription: false, amount_agorot: 20000, currency: "ILS" });
  await conversions.track(USER_ID, { name: "bot_created", source: "new" });

  assert.deepEqual({ sent, lookups }, { sent: [], lookups: [] });
});

test("a user with no browser on record is skipped, since Meta rejects website events without a user agent", async () => {
  const { conversions, sent } = setup({ identity: { ...IDENTITY, browser: { ...BROWSER, userAgent: null } } });

  const { logged } = await quietly(() => conversions.track(USER_ID, { name: "trial_started" }));

  assert.deepEqual(sent, []);
  assert.ok(logged.some((line) => line.includes("conversion skipped")));
});

test("a deleted account sends nothing", async () => {
  const { conversions, sent } = setup({ identity: null });

  await conversions.track(USER_ID, { name: "trial_started" });

  assert.deepEqual(sent, []);
});

test("without a config nothing is stored, looked up or sent", async () => {
  const { conversions, sent, stored, lookups } = setup({ config: null });

  await conversions.rememberBrowser(USER_ID, new Headers({ "user-agent": "Mozilla/5.0" }));
  await conversions.track(USER_ID, { name: "signed_up", method: "email" });

  assert.deepEqual({ sent, stored, lookups }, { sent: [], stored: [], lookups: [] });
});

test("a refused or failing send is logged and never thrown", async () => {
  const refused = setup({ result: { ok: false, status: 400, errorCode: 100, error: "Invalid parameter" } });
  const broken = setup({ store: { findIdentity: () => Promise.reject(new Error("Failed query: select\nparams: dana@example.com")) } });

  const first = await quietly(() => refused.conversions.track(USER_ID, { name: "trial_started" }));
  const second = await quietly(() => broken.conversions.track(USER_ID, { name: "trial_started" }));

  assert.ok(first.logged.some((line) => line.includes("conversion rejected")));
  assert.ok(second.logged.some((line) => line.includes("conversion failed")));
  assert.ok(second.logged.every((line) => !line.includes("dana@example.com")));
});

test("the signing-in browser is stored, and a storage failure never fails the sign-in", async () => {
  const { conversions, stored } = setup();
  const failing = setup({ store: { remember: () => Promise.reject(new Error("Failed query: insert\nparams: 2a02:6680:1100::1")) } });
  const headers = new Headers({ "user-agent": "Mozilla/5.0", "x-vercel-ip-country": "IL" });

  await conversions.rememberBrowser(USER_ID, headers);
  const { logged } = await quietly(() => failing.conversions.rememberBrowser(USER_ID, headers));

  assert.deepEqual(stored, [{ userId: USER_ID, ids: { fbp: null, fbc: null, clientIp: null, userAgent: "Mozilla/5.0", country: "il" } }]);
  assert.ok(logged.some((line) => line.includes("storing browser ids failed")));
  assert.ok(logged.every((line) => !line.includes("2a02")));
});

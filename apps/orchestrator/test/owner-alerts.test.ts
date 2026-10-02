import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { AgentOwnerAlerts } from "../src/services/whatsapp-cloud/owner-alerts.js";
import type { HostRuntimes } from "../src/services/host-runtimes.js";
import type { OwnerTurnDelivery } from "../src/services/agent-runtime/types.js";
import type { Instance } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const silentLog = { warn: () => {}, error: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const ROUTE = { channel: "telegram" as const, to: "123456" };

function harness(opts: { start?: () => Promise<string | null>; deliveries?: OwnerTurnDelivery[] }) {
  const started: { containerId: string; waId: string }[] = [];
  const cancelled: string[] = [];
  const deliveries = [...(opts.deliveries ?? [])];
  let clock = 0;
  const adapter = {
    startCustomerAlert: async (containerId: string, _route: unknown, alert: { waId: string }) => {
      started.push({ containerId, waId: alert.waId });
      return opts.start ? opts.start() : "job-1";
    },
    customerAlertDelivery: async () => deliveries.shift() ?? "pending",
    cancelCustomerAlert: async (_containerId: string, alertId: string) => {
      cancelled.push(alertId);
    },
  };
  const hosts = { for: () => ({ adapters: { get: () => adapter } }) } as unknown as HostRuntimes;
  const alerts = new AgentOwnerAlerts(
    hosts,
    silentLog,
    async (ms) => {
      clock += ms;
    },
    () => clock,
  );
  let fallbacks = 0;
  const fallback = async () => {
    fallbacks += 1;
  };
  return { alerts, started, cancelled, fallback, fallbacks: () => fallbacks };
}

const bot = (): Instance => ({ ...makeInstance([]), containerId: "container-1" });

test("a delivered alert never falls back, and its job is removed so no retry alerts again", async () => {
  const h = harness({ deliveries: ["pending", "delivered"] });

  assert.equal(await h.alerts.start(bot(), ROUTE, "972501234567", h.fallback), true);
  await h.alerts.settle();

  assert.deepEqual(h.started, [{ containerId: "container-1", waId: "972501234567" }]);
  assert.deepEqual(h.cancelled, ["job-1"]);
  assert.equal(h.fallbacks(), 0);
});

test("a failed delivery cancels the job, then falls back to the direct message once", async () => {
  const h = harness({ deliveries: ["pending", "failed"] });

  await h.alerts.start(bot(), ROUTE, "972501234567", h.fallback);
  await h.alerts.settle();

  assert.deepEqual(h.cancelled, ["job-1"]);
  assert.equal(h.fallbacks(), 1);
});

test("an alert still pending at the deadline is cancelled so a late run cannot alert twice", async () => {
  const h = harness({});

  await h.alerts.start(bot(), ROUTE, "972501234567", h.fallback);
  await h.alerts.settle();

  assert.deepEqual(h.cancelled, ["job-1"]);
  assert.equal(h.fallbacks(), 1);
});

test("no container, no support or a refused start leaves the caller to send directly", async () => {
  const noContainer = harness({});
  assert.equal(await noContainer.alerts.start({ ...bot(), containerId: null }, ROUTE, "972501234567", noContainer.fallback), false);

  const unsupported = harness({ start: async () => null });
  assert.equal(await unsupported.alerts.start(bot(), ROUTE, "972501234567", unsupported.fallback), false);

  const refused = harness({ start: async () => Promise.reject(new Error("gateway down")) });
  assert.equal(await refused.alerts.start(bot(), ROUTE, "972501234567", refused.fallback), false);

  for (const h of [noContainer, unsupported, refused]) {
    await h.alerts.settle();
    assert.equal(h.fallbacks(), 0);
  }
});

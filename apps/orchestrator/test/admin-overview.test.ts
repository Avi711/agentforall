import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { AdminOverviewService } from "../src/services/admin-overview.js";
import type { BotUsage } from "../src/domain/types.js";
import { makeInstance } from "./helpers/fixtures.js";

const logger = { warn: () => {} } as unknown as FastifyBaseLogger;

test("admin overview lists every live instance and tolerates per-bot usage failures", async () => {
  const a = makeInstance([{ type: "telegram" }], { id: "a", userId: "user-a" });
  const b = makeInstance([{ type: "whatsapp" }], { id: "b", userId: "user-b" });
  const usageA: BotUsage = {
    supported: true,
    spendCents: 120,
    maxBudgetCents: 5000,
    budgetDuration: "30d",
    budgetResetAt: null,
    keyAlias: "k",
    models: [],
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
  const asked: string[] = [];
  const service = new AdminOverviewService(
    { findAllActive: async () => [a, b] },
    {
      getBotUsage: async (inst) => {
        asked.push(inst.id);
        if (inst.id === b.id) throw new Error("litellm down");
        return usageA;
      },
    },
    logger,
  );

  const rows = await service.listInstances();
  assert.deepEqual(rows.map((r) => r.instance.id), ["a", "b"]);
  assert.deepEqual(rows[0]?.usage, usageA);
  assert.equal(rows[1]?.usage, null);
  assert.deepEqual(asked.sort(), ["a", "b"]);
});

test("admin overview keeps input order under bounded concurrency", async () => {
  const items = Array.from({ length: 9 }, (_, i) =>
    makeInstance([{ type: "telegram" }], { id: `i${i}`, userId: `u${i}` }),
  );
  let inFlight = 0;
  let peak = 0;
  const service = new AdminOverviewService(
    { findAllActive: async () => items },
    {
      getBotUsage: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { supported: false, reason: "not_litellm" };
      },
    },
    logger,
  );

  const rows = await service.listInstances();
  assert.deepEqual(rows.map((r) => r.instance.id), items.map((i) => i.id));
  assert.ok(peak >= 2 && peak <= 4, `peak concurrency ${peak}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeConsumption,
  availableCredits,
  consumptionOrder,
  currentAllowance,
  isGrantLive,
} from "../../src/lib/billing/credits/allocation";
import { NOW, grant } from "./fakes";

const later = new Date(NOW.getTime() + 1000);
const earlier = new Date(NOW.getTime() - 1000);

test("consumptionOrder spends soonest-expiring first and perpetual top-ups last", () => {
  const topup = grant({ kind: "topup", expiresAt: null, grantedAt: earlier });
  const plan = grant({ kind: "plan", expiresAt: new Date("2026-09-29T00:00:00.000Z") });
  const trial = grant({ kind: "trial", expiresAt: new Date("2026-09-02T00:00:00.000Z") });
  assert.deepEqual(consumptionOrder([topup, plan, trial]).map((g) => g.kind), ["trial", "plan", "topup"]);
});

test("consumptionOrder breaks ties by grant time, for expiring and perpetual grants alike", () => {
  const first = grant({ expiresAt: later, grantedAt: earlier });
  const second = grant({ expiresAt: later, grantedAt: later });
  assert.deepEqual(consumptionOrder([second, first]).map((g) => g.id), [first.id, second.id]);
  const oldTopup = grant({ kind: "topup", expiresAt: null, grantedAt: earlier });
  const newTopup = grant({ kind: "topup", expiresAt: null, grantedAt: later });
  assert.deepEqual(consumptionOrder([newTopup, oldTopup]).map((g) => g.id), [oldTopup.id, newTopup.id]);
});

test("attributeConsumption fills grants in order and skips dead ones", () => {
  const expired = grant({ kind: "trial", credits: 400, expiresAt: earlier });
  const exhausted = grant({ kind: "plan", credits: 100, usedCredits: 100 });
  const plan = grant({ kind: "plan", credits: 1000, usedCredits: 900 });
  const topup = grant({ kind: "topup", credits: 500, expiresAt: null });
  const result = attributeConsumption([topup, plan, exhausted, expired], 250, NOW);
  assert.deepEqual(result.attributions, [
    { grantId: plan.id, credits: 100 },
    { grantId: topup.id, credits: 150 },
  ]);
  assert.equal(result.unallocated, 0);
});

test("attributeConsumption judges liveness as of the consumption time", () => {
  const plan = grant({ credits: 100, expiresAt: NOW });
  assert.equal(attributeConsumption([plan], 10, earlier).attributions[0]?.grantId, plan.id);
  assert.equal(attributeConsumption([plan], 10, NOW).unallocated, 10);
});

test("attributeConsumption reports what no grant could absorb", () => {
  const plan = grant({ credits: 100, usedCredits: 90 });
  const result = attributeConsumption([plan], 50, NOW);
  assert.deepEqual(result.attributions, [{ grantId: plan.id, credits: 10 }]);
  assert.equal(result.unallocated, 40);
});

test("attributeConsumption with nothing consumed touches nothing and rejects invalid amounts", () => {
  assert.deepEqual(attributeConsumption([grant()], 0, NOW), { attributions: [], unallocated: 0 });
  assert.throws(() => attributeConsumption([], -1, NOW), RangeError);
  assert.throws(() => attributeConsumption([], 1.5, NOW), RangeError);
});

test("availableCredits and currentAllowance count only live grants", () => {
  const grants = [
    grant({ credits: 1000, usedCredits: 300 }),
    grant({ kind: "topup", credits: 500, usedCredits: 0, expiresAt: null }),
    grant({ kind: "trial", credits: 400, usedCredits: 100, expiresAt: earlier }),
    grant({ credits: 200, usedCredits: 200 }),
  ];
  assert.equal(availableCredits(grants, NOW), 1200);
  assert.equal(currentAllowance(grants, NOW), 1500);
});

test("isGrantLive: expiry is exclusive at the boundary; over-used grants are dead", () => {
  assert.equal(isGrantLive(grant({ expiresAt: NOW }), NOW), false);
  assert.equal(isGrantLive(grant({ expiresAt: later }), NOW), true);
  assert.equal(isGrantLive(grant({ expiresAt: null }), NOW), true);
  assert.equal(isGrantLive(grant({ credits: 10, usedCredits: 11, expiresAt: null }), NOW), false);
});

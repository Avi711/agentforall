import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { NoPlacementError } from "../src/domain/errors.js";
import type { HostRuntime, HostRuntimes } from "../src/services/host-runtimes.js";
import { Placement, type PlacementConfig } from "../src/services/placement.js";

interface Spec {
  capacityMb?: number | null;
  status?: HostRuntime["status"];
  reachable?: boolean;
  usedMb?: number;
}

const DEFAULTS: PlacementConfig = { overcommit: 1, reserveMb: 2048 };

function harness(specs: Record<string, Spec>, config: PlacementConfig = DEFAULTS) {
  const measured = new Set<string>();
  const clock = { nowMs: 0 };
  const all = Object.entries(specs).map(
    ([hostId, spec]) =>
      ({
        hostId,
        address: null,
        capacityMb: spec.capacityMb === undefined ? 32_089 : spec.capacityMb,
        status: spec.status ?? "active",
        gate: { check: async () => spec.reachable ?? true },
      }) as HostRuntime,
  );
  const hosts: HostRuntimes = { for: () => all[0]!, all: () => all };
  const usage = {
    usedMb: (hostId: string) => specs[hostId]?.usedMb ?? 0,
    measured: (instanceId: string) => measured.has(instanceId),
  };
  const warnings: Array<Record<string, unknown>> = [];
  const logger = {
    info: () => undefined,
    warn: (ctx: Record<string, unknown>) => void warnings.push(ctx),
  } as unknown as FastifyBaseLogger;
  return { placement: new Placement(hosts, usage, config, logger, () => clock.nowMs), warnings, measured, clock };
}

test("prod today: 15 bots measured at 7,100 MB on a 32,089 MB host leave room for another 4 GB bot", async () => {
  const { placement } = harness({ "agent-forall-vm": { usedMb: 7100 } });
  assert.equal(await placement.choose(4096, "bot"), "agent-forall-vm");
});

test("the host with the most headroom wins, whatever its order", async () => {
  const { placement } = harness({ a: { usedMb: 20_000 }, b: { usedMb: 5_000 }, c: { usedMb: 12_000 } });
  assert.equal(await placement.choose(4096, "bot"), "b");
});

test("draining hosts, hosts of unknown capacity and unreachable hosts are never chosen", async () => {
  const { placement } = harness({
    draining: { status: "draining" },
    unknown: { capacityMb: null },
    down: { reachable: false },
    ok: { usedMb: 20_000 },
  });
  assert.equal(await placement.choose(4096, "bot"), "ok");
});

test("assertFits accepts a draining target with room (an operator's move) but still refuses an unreachable or full one", async () => {
  await harness({ draining: { status: "draining", usedMb: 1000 } }).placement.assertFits("draining", 4096);
  await assert.rejects(harness({ down: { reachable: false } }).placement.assertFits("down", 4096), NoPlacementError);
  await assert.rejects(harness({ full: { usedMb: 30_000 } }).placement.assertFits("full", 4096), NoPlacementError);
});

test("a host is refused once the new bot would push it past 90 % of capacity minus the reserve", async () => {
  const budget = 0.9 * (32_089 - 2048);
  const fits = harness({ a: { usedMb: Math.floor(budget - 4096) } });
  assert.equal(await fits.placement.choose(4096, "bot"), "a");
  const full = harness({ a: { usedMb: Math.ceil(budget - 4096) + 1 } });
  await assert.rejects(full.placement.choose(4096, "bot"), NoPlacementError);
});

test("overcommit counts only a share of the new bot's limit; the reserve comes off the top", async () => {
  const tight = harness({ a: { capacityMb: 8192, usedMb: 1000 } }, { overcommit: 1, reserveMb: 2048 });
  await assert.rejects(tight.placement.choose(6000, "bot"), NoPlacementError);
  const shared = harness({ a: { capacityMb: 8192, usedMb: 1000 } }, { overcommit: 2, reserveMb: 2048 });
  assert.equal(await shared.placement.choose(6000, "bot"), "a");
  const noReserve = harness({ a: { capacityMb: 8192, usedMb: 1000 } }, { overcommit: 1, reserveMb: 0 });
  assert.equal(await noReserve.placement.choose(6000, "bot"), "a");
});

test("refusal is a 503 NO_PLACEMENT and the log names every host with its headroom or why it was skipped", async () => {
  const { placement, warnings } = harness({
    full: { usedMb: 30_000 },
    draining: { status: "draining" },
    unknown: { capacityMb: null },
    down: { reachable: false },
  });
  await assert.rejects(
    placement.choose(4096, "bot"),
    (err: unknown) => err instanceof NoPlacementError && err.statusCode === 503 && err.code === "NO_PLACEMENT",
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.memoryMb, 4096);
  assert.deepEqual(warnings[0]?.hosts, [
    { hostId: "full", headroomMb: Math.floor(0.9 * (32_089 - 2048) - 30_000 - 4096), skipped: null },
    { hostId: "draining", headroomMb: null, skipped: "draining" },
    { hostId: "unknown", headroomMb: null, skipped: "capacity unknown" },
    { hostId: "down", headroomMb: null, skipped: "unreachable" },
  ]);
});

test("no managed host at all is the same refusal", async () => {
  await assert.rejects(harness({}).placement.choose(4096, "bot"), NoPlacementError);
});

test("a burst inside one measurement window spreads out: each placed bot counts against its host until measured", async () => {
  const { placement } = harness({ a: { usedMb: 5_000 }, b: { usedMb: 6_000 } });
  assert.equal(await placement.choose(4096, "first"), "a");
  assert.equal(await placement.choose(4096, "second"), "b");
});

test("a burst never fills a host past its budget: the second bot is refused, not squeezed in", async () => {
  const budget = 0.9 * (32_089 - 2048);
  const { placement } = harness({ a: { usedMb: Math.floor(budget - 4096) - 100 } });
  assert.equal(await placement.choose(4096, "first"), "a");
  await assert.rejects(placement.choose(4096, "second"), NoPlacementError);
});

test("once a sweep has measured the bot, its reservation gives way to the measured figure", async () => {
  const specs: Record<string, Spec> = { a: { usedMb: 5_000 }, b: { usedMb: 6_000 } };
  const { placement, measured } = harness(specs);
  assert.equal(await placement.choose(4096, "first"), "a");
  measured.add("first");
  specs.a!.usedMb = 5_400;
  assert.equal(await placement.choose(4096, "second"), "a");
});

test("a bot that is never measured (its provisioning failed) stops counting after the reservation expires", async () => {
  const { placement, clock } = harness({ a: { usedMb: 5_000 }, b: { usedMb: 6_000 } });
  assert.equal(await placement.choose(4096, "failed"), "a");
  clock.nowMs += 31 * 60_000;
  assert.equal(await placement.choose(4096, "next"), "a");
});

test("a move target's check counts bots placed there since the last sweep", async () => {
  const budget = 0.9 * (32_089 - 2048);
  const { placement } = harness({ a: { usedMb: Math.floor(budget - 4096) - 100 } });
  assert.equal(await placement.choose(4096, "placed"), "a");
  await assert.rejects(placement.assertFits("a", 4096), NoPlacementError);
});

test("concurrent placements see each other's reservation", async () => {
  const { placement } = harness({ a: { usedMb: 5_000 }, b: { usedMb: 6_000 } });
  const chosen = await Promise.all([placement.choose(4096, "x"), placement.choose(4096, "y")]);
  assert.deepEqual(chosen.sort(), ["a", "b"]);
});

test("a released reservation stops counting at once", async () => {
  const { placement } = harness({ a: { usedMb: 5_000 }, b: { usedMb: 6_000 } });
  assert.equal(await placement.choose(4096, "failed"), "a");
  placement.release("failed");
  assert.equal(await placement.choose(4096, "next"), "a");
});

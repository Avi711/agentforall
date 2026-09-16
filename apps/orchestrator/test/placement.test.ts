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
  const usage = { usedMb: (hostId: string) => specs[hostId]?.usedMb ?? 0 };
  const warnings: Array<Record<string, unknown>> = [];
  const logger = {
    info: () => undefined,
    warn: (ctx: Record<string, unknown>) => void warnings.push(ctx),
  } as unknown as FastifyBaseLogger;
  return { placement: new Placement(hosts, usage, config, logger), warnings };
}

test("prod today: 15 bots measured at 7,100 MB on a 32,089 MB host leave room for another 4 GB bot", async () => {
  const { placement } = harness({ "agent-forall-vm": { usedMb: 7100 } });
  assert.equal(await placement.choose(4096), "agent-forall-vm");
});

test("the host with the most headroom wins, whatever its order", async () => {
  const { placement } = harness({ a: { usedMb: 20_000 }, b: { usedMb: 5_000 }, c: { usedMb: 12_000 } });
  assert.equal(await placement.choose(4096), "b");
});

test("draining hosts, hosts of unknown capacity and unreachable hosts are never chosen", async () => {
  const { placement } = harness({
    draining: { status: "draining" },
    unknown: { capacityMb: null },
    down: { reachable: false },
    ok: { usedMb: 20_000 },
  });
  assert.equal(await placement.choose(4096), "ok");
});

test("a host is refused once the new bot would push it past 90 % of capacity minus the reserve", async () => {
  const budget = 0.9 * (32_089 - 2048);
  const fits = harness({ a: { usedMb: Math.floor(budget - 4096) } });
  assert.equal(await fits.placement.choose(4096), "a");
  const full = harness({ a: { usedMb: Math.ceil(budget - 4096) + 1 } });
  await assert.rejects(full.placement.choose(4096), NoPlacementError);
});

test("overcommit counts only a share of the new bot's limit; the reserve comes off the top", async () => {
  const tight = harness({ a: { capacityMb: 8192, usedMb: 1000 } }, { overcommit: 1, reserveMb: 2048 });
  await assert.rejects(tight.placement.choose(6000), NoPlacementError);
  const shared = harness({ a: { capacityMb: 8192, usedMb: 1000 } }, { overcommit: 2, reserveMb: 2048 });
  assert.equal(await shared.placement.choose(6000), "a");
  const noReserve = harness({ a: { capacityMb: 8192, usedMb: 1000 } }, { overcommit: 1, reserveMb: 0 });
  assert.equal(await noReserve.placement.choose(6000), "a");
});

test("refusal is a 503 NO_PLACEMENT and the log names every host with its headroom or why it was skipped", async () => {
  const { placement, warnings } = harness({
    full: { usedMb: 30_000 },
    draining: { status: "draining" },
    unknown: { capacityMb: null },
    down: { reachable: false },
  });
  await assert.rejects(
    placement.choose(4096),
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
  await assert.rejects(harness({}).placement.choose(4096), NoPlacementError);
});

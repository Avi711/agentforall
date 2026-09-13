import { test } from "node:test";
import assert from "node:assert/strict";
import type Docker from "dockerode";
import type { FastifyBaseLogger } from "fastify";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";

function runtimeWithStats(stats: unknown | Error): DockerContainerRuntime {
  const docker = {
    getContainer: () => ({
      stats: async () => {
        if (stats instanceof Error) throw stats;
        return stats;
      },
    }),
  } as unknown as Docker;
  return new DockerContainerRuntime(docker, "net", {} as FastifyBaseLogger);
}

test("cgroup v2: usage minus inactive_file, limit as reported", async () => {
  const runtime = runtimeWithStats({
    memory_stats: { usage: 1000, limit: 4000, stats: { inactive_file: 200, anon: 700 } },
  });
  assert.deepEqual(await runtime.memoryUsage("c"), { usedBytes: 800, limitBytes: 4000 });
});

test("cgroup v1: total_inactive_file wins over the non-hierarchical key", async () => {
  const runtime = runtimeWithStats({
    memory_stats: { usage: 1000, limit: 4000, stats: { total_inactive_file: 300, inactive_file: 50, cache: 900 } },
  });
  assert.deepEqual(await runtime.memoryUsage("c"), { usedBytes: 700, limitBytes: 4000 });
});

test("a stopped container's empty stats read as null, and usage never goes negative", async () => {
  assert.equal(await runtimeWithStats({ memory_stats: {} }).memoryUsage("c"), null);
  assert.deepEqual(
    await runtimeWithStats({ memory_stats: { usage: 100, limit: 4000, stats: { inactive_file: 500 } } }).memoryUsage("c"),
    { usedBytes: 0, limitBytes: 4000 },
  );
});

test("a container docker no longer knows is null, other failures propagate", async () => {
  const gone = Object.assign(new Error("no such container"), { statusCode: 404 });
  assert.equal(await runtimeWithStats(gone).memoryUsage("c"), null);
  await assert.rejects(() => runtimeWithStats(new Error("socket hang up")).memoryUsage("c"), /socket hang up/);
});

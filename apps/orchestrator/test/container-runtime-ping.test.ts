import { test } from "node:test";
import assert from "node:assert/strict";
import type Docker from "dockerode";
import type { FastifyBaseLogger } from "fastify";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";

test("ping hands dockerode an abort signal so a half-open socket cannot hang a pass", async () => {
  const seen: unknown[] = [];
  const docker = {
    ping: async (options: unknown) => {
      seen.push(options);
      return "OK";
    },
  } as unknown as Docker;
  await new DockerContainerRuntime(docker, "net", {} as FastifyBaseLogger).ping();
  const options = seen[0] as { abortSignal?: unknown };
  assert.ok(options.abortSignal instanceof AbortSignal);
  assert.equal(options.abortSignal.aborted, false);
});

test("a ping the daemon refuses rejects instead of resolving", async () => {
  const docker = {
    ping: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  } as unknown as Docker;
  await assert.rejects(new DockerContainerRuntime(docker, "net", {} as FastifyBaseLogger).ping(), /ECONNREFUSED/);
});

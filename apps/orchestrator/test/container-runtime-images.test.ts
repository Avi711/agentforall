import { test } from "node:test";
import assert from "node:assert/strict";
import type Docker from "dockerode";
import type { FastifyBaseLogger } from "fastify";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";
import { UpstreamUnavailableError } from "../src/domain/errors.js";

function fakeDocker(present: boolean) {
  const pulls: string[] = [];
  const docker = {
    pull: async (image: string) => {
      pulls.push(image);
      return {};
    },
    modem: { followProgress: (_s: unknown, done: (err: Error | null) => void) => done(null) },
    getImage: () => ({
      inspect: async () => {
        if (present) return { Id: "sha256:abc" };
        throw Object.assign(new Error("no such image"), { statusCode: 404 });
      },
    }),
  } as unknown as Docker;
  return { runtime: new DockerContainerRuntime(docker, "tenant-net", {} as FastifyBaseLogger), pulls };
}

test("ensureImagePresent never pulls: it passes when the image is on the host and names the host's duty when it is not", async () => {
  const present = fakeDocker(true);
  await present.runtime.ensureImagePresent("img@sha256:1");
  assert.deepEqual(present.pulls, []);

  const missing = fakeDocker(false);
  await assert.rejects(
    missing.runtime.ensureImagePresent("img@sha256:1"),
    (err: unknown) => err instanceof UpstreamUnavailableError && /img@sha256:1 is not on this host/.test(err.message),
  );
  assert.deepEqual(missing.pulls, []);
});

test("pullImage is the explicit dev-only pull", async () => {
  const d = fakeDocker(false);
  await d.runtime.pullImage("img@sha256:1");
  assert.deepEqual(d.pulls, ["img@sha256:1"]);
});

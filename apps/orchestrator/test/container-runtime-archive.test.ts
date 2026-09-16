import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type Docker from "dockerode";
import type { FastifyBaseLogger } from "fastify";
import { DockerContainerRuntime } from "../src/services/docker-container-runtime.js";

function fakeDocker(volumes: string[]) {
  const archiveCalls: { id: string; path: string; signal: AbortSignal | undefined }[] = [];
  const putCalls: { id: string; path: string; signal: AbortSignal | undefined }[] = [];
  const inspected: string[] = [];
  const docker = {
    getContainer: (id: string) => ({
      getArchive: async (opts: { path: string; abortSignal?: AbortSignal }) => {
        archiveCalls.push({ id, path: opts.path, signal: opts.abortSignal });
        return Readable.from([Buffer.from("tar-bytes")]);
      },
      putArchive: async (_archive: Readable, opts: { path: string; abortSignal?: AbortSignal }) => {
        putCalls.push({ id, path: opts.path, signal: opts.abortSignal });
      },
    }),
    getVolume: (name: string) => ({
      inspect: async () => {
        inspected.push(name);
        if (!volumes.includes(name)) throw Object.assign(new Error("no such volume"), { statusCode: 404 });
        return { Name: name };
      },
    }),
  } as unknown as Docker;
  return { runtime: new DockerContainerRuntime(docker, "tenant-net", {} as FastifyBaseLogger), archiveCalls, putCalls, inspected };
}

test("getArchive asks Docker for the path's archive and hands the stream back as-is", async () => {
  const { runtime, archiveCalls } = fakeDocker([]);
  const stream = await runtime.getArchive("c-1", "/home/node/.openclaw");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  assert.deepEqual(archiveCalls, [{ id: "c-1", path: "/home/node/.openclaw", signal: undefined }]);
  assert.equal(Buffer.concat(chunks).toString(), "tar-bytes");
});

test("an abort signal reaches Docker on both the archive read and the archive write", async () => {
  const { runtime, archiveCalls, putCalls } = fakeDocker([]);
  const signal = AbortSignal.timeout(60_000);
  await runtime.getArchive("c-1", "/home/node/.openclaw", signal);
  await runtime.putArchive("c-1", "/home/node", Readable.from([Buffer.from("tar")]), signal);
  assert.equal(archiveCalls[0]?.signal, signal);
  assert.deepEqual(putCalls, [{ id: "c-1", path: "/home/node", signal }]);
});

test("hasVolume is true for an existing volume, false on 404 and rethrows anything else", async () => {
  const { runtime, inspected } = fakeDocker(["oc-1-state"]);
  assert.equal(await runtime.hasVolume("oc-1-state"), true);
  assert.equal(await runtime.hasVolume("oc-2-state"), false);
  assert.deepEqual(inspected, ["oc-1-state", "oc-2-state"]);

  const broken = {
    getVolume: () => ({
      inspect: async () => {
        throw Object.assign(new Error("daemon down"), { statusCode: 500 });
      },
    }),
  } as unknown as Docker;
  await assert.rejects(
    () => new DockerContainerRuntime(broken, "tenant-net", {} as FastifyBaseLogger).hasVolume("x"),
    /daemon down/,
  );
});

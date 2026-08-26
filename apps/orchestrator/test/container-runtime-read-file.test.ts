import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type Docker from "dockerode";
import type { FastifyBaseLogger } from "fastify";
import tar from "tar-stream";
import { ContainerRuntime } from "../src/services/container-runtime.js";

function tarOf(entries: { name: string; body: string }[]): Promise<Buffer> {
  const pack = tar.pack();
  for (const entry of entries) pack.entry({ name: entry.name }, entry.body);
  pack.finalize();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pack.on("data", (chunk: Buffer) => chunks.push(chunk));
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.on("error", reject);
  });
}

function runtimeReturning(archive: Buffer | Error): ContainerRuntime {
  const docker = {
    getContainer: () => ({
      getArchive: async () => {
        if (archive instanceof Error) throw archive;
        return Readable.from([archive]);
      },
    }),
  } as unknown as Docker;
  return new ContainerRuntime(docker, "net", {} as FastifyBaseLogger);
}

function notFound(): Error {
  return Object.assign(new Error("no such file"), { statusCode: 404 });
}

test("reads the file out of the archive docker returns", async () => {
  const runtime = runtimeReturning(await tarOf([{ name: "openclaw.json", body: '{"a":1}' }]));
  const read = await runtime.readFile("c", "/home/node/.openclaw/openclaw.json", 1024);
  assert.equal(read?.toString("utf8"), '{"a":1}');
});

// A container that never had the file is a real answer, not a failure: it is how a freshly
// created one is told apart from one whose config we simply could not read.
test("a missing file reads as null, not as an error", async () => {
  const runtime = runtimeReturning(notFound());
  assert.equal(await runtime.readFile("c", "/nope", 1024), null);
});

test("a docker failure that is not a missing file propagates", async () => {
  const runtime = runtimeReturning(Object.assign(new Error("boom"), { statusCode: 500 }));
  await assert.rejects(() => runtime.readFile("c", "/x", 1024), /boom/);
});

// Truncating silently would hand the caller a half config to merge and write back.
test("a file past the limit fails instead of returning a truncated one", async () => {
  const runtime = runtimeReturning(await tarOf([{ name: "big", body: "x".repeat(200) }]));
  await assert.rejects(() => runtime.readFile("c", "/big", 100), /larger than 100 bytes/);
});

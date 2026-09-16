import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthService } from "../src/services/health-service.js";
import type { HealthRepository } from "../src/storage/health-repository.js";

const repoThat = (ping: () => Promise<void>) => ({ ping }) as unknown as HealthRepository;

test("a reachable database is the whole answer; Docker is not part of the process probe", async () => {
  const report = await new HealthService(repoThat(async () => undefined)).check();
  assert.deepEqual(report, { status: "healthy", checks: { database: "ok" }, httpStatus: 200 });
});

test("a database failure is reported, never thrown", async () => {
  const report = await new HealthService(repoThat(async () => Promise.reject(new Error("down")))).check();
  assert.deepEqual(report, { status: "unhealthy", checks: { database: "error" }, httpStatus: 503 });
});

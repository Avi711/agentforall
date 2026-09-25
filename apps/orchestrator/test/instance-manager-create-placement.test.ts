import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../src/config.js";
import { QuotaExceededError } from "../src/domain/errors.js";
import { InstanceManager } from "../src/services/instance-manager.js";

function harness(insert: (attempt: number) => unknown) {
  const chosen: string[] = [];
  const released: string[] = [];
  let attempt = 0;
  const repo = { insertIfUserActiveBelowLimit: async () => insert(attempt++) };
  const hosts = { for: () => ({ adapters: { get: () => ({ containerName: (id: string) => `c-${id}` }) } }) };
  const placement = {
    choose: async (_memoryMb: number, instanceId: string) => {
      chosen.push(instanceId);
      return "host";
    },
    release: (instanceId: string) => void released.push(instanceId),
  };
  const manager = new InstanceManager(
    repo as never,
    hosts as never,
    { allocate: async () => 19000 } as never,
    placement as never,
    { maxProvisionRetries: 3, agentRuntimeKind: "openclaw", maxInstancesPerUser: 1 } as AppConfig,
    { append: async () => {} } as never,
    {} as never,
    { revokeKey: async () => {} } as never,
    { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger,
  );
  const create = () =>
    manager.create("user-1", {
      displayName: "bot",
      provider: { kind: "gateway", apiKey: "k", model: "m" },
      channels: [{ type: "whatsapp" }],
    } as never);
  return { create, chosen, released };
}

test("a create refused by the quota releases its placement", async () => {
  const h = harness(() => null);
  await assert.rejects(h.create(), QuotaExceededError);
  assert.deepEqual(h.released, h.chosen);
});

test("every attempt lost to a port race releases its placement", async () => {
  const h = harness(() => {
    throw Object.assign(new Error("duplicate"), { code: "23505" });
  });
  await assert.rejects(h.create());
  assert.equal(h.chosen.length, 3);
  assert.deepEqual(h.released, h.chosen);
});

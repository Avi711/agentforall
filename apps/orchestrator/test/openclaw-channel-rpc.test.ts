import { test } from "node:test";
import assert from "node:assert/strict";
import { channelStartOutcomeOf, startOpenclawChannel } from "../src/services/agent-runtime/openclaw/channel-rpc.js";
import type { GatewayCall } from "../src/services/agent-runtime/openclaw/gateway-call.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";

const ok = (payload: unknown) => ({ status: "ok" as const, payload });

test("channel start asks the gateway for channels.start with admin scope", async () => {
  const calls: GatewayCall[] = [];
  const runtime = {
    execCommandBuffer: async (_id: string, _cmd: string[], _t: number, _m: number, input?: Buffer) => {
      calls.push(JSON.parse(input?.toString("utf8") ?? "null") as GatewayCall);
      return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, payload: { started: true } })), stderr: "" };
    },
  } as unknown as ContainerRuntime;

  assert.deepEqual(await startOpenclawChannel(runtime, "container-1", "whatsapp", 9000), { status: "started" });
  assert.deepEqual(calls, [
    { method: "channels.start", params: { channel: "whatsapp" }, scopes: ["operator.read", "operator.admin"] },
  ]);
});

test("a started or already-running channel reads as started", () => {
  assert.deepEqual(channelStartOutcomeOf(ok({ started: true, outcome: { status: "handed-off", reason: null } })), {
    status: "started",
  });
  assert.deepEqual(channelStartOutcomeOf(ok({ started: false, outcome: { status: "skipped" } })), { status: "started" });
  assert.deepEqual(channelStartOutcomeOf(ok({ started: true })), { status: "started" });
  assert.deepEqual(channelStartOutcomeOf(ok({ started: true, outcome: null })), { status: "started" });
});

test("a refused start carries the gateway's reason", () => {
  assert.deepEqual(channelStartOutcomeOf(ok({ started: false, outcome: { status: "retry", reason: "not configured" } })), {
    status: "unavailable",
    reason: "not configured",
  });
  assert.deepEqual(channelStartOutcomeOf({ status: "unreachable", reason: "timeout" }), {
    status: "unavailable",
    reason: "timeout",
  });
  assert.deepEqual(channelStartOutcomeOf({ status: "refused", code: "INVALID_REQUEST", reason: "unknown channel" }), {
    status: "unavailable",
    reason: "unknown channel",
  });
});

test("an answer that does not say started never reads as started", () => {
  assert.equal(channelStartOutcomeOf(ok({})).status, "unavailable");
  assert.equal(channelStartOutcomeOf(ok(null)).status, "unavailable");
  assert.equal(channelStartOutcomeOf(ok({ started: "yes" })).status, "unavailable");
});

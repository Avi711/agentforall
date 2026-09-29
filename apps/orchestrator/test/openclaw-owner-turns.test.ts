import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerTurnJob, scheduleOpenclawOwnerTurns } from "../src/services/agent-runtime/openclaw/owner-turns.js";
import type { GatewayCall } from "../src/services/agent-runtime/openclaw/gateway-call.js";
import type { OwnerTurn } from "../src/services/agent-runtime/types.js";
import type { OwnerRoute } from "../src/domain/owner.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { UpstreamUnavailableError, ValidationError } from "../src/domain/errors.js";

const ROUTE: OwnerRoute = { channel: "whatsapp", to: "+972501234567" };
const TURNS: OwnerTurn[] = [1, 2].map((n) => ({
  key: `agentforall:onboarding-checkin-${n}`,
  name: `Check-in ${n}`,
  at: new Date(`2026-10-0${n}T16:00:00Z`),
  message: `task ${n}`,
}));

test("a turn becomes a one-off job in the owner's own session, delivered best-effort to the owner's DM", () => {
  assert.deepEqual(ownerTurnJob(ROUTE, TURNS[0]!), {
    declarationKey: "agentforall:onboarding-checkin-1",
    name: "Check-in 1",
    agentId: "main",
    schedule: { kind: "at", at: "2026-10-01T16:00:00.000Z" },
    sessionTarget: "session:agent:main:direct:owner",
    deleteAfterRun: true,
    payload: { kind: "agentTurn", message: "task 1", timeoutSeconds: 600 },
    delivery: { mode: "announce", channel: "whatsapp", to: "+972501234567", bestEffort: true },
    failureAlert: false,
  });
});

function fakeRuntime(answers: string[]): { runtime: ContainerRuntime; calls: GatewayCall[] } {
  const calls: GatewayCall[] = [];
  const runtime = {
    execCommandBuffer: async (_id: string, _cmd: string[], _timeout: number, _max: number, input?: Buffer) => {
      calls.push(JSON.parse(input?.toString("utf8") ?? "null") as GatewayCall);
      return { exitCode: 0, stdout: Buffer.from(answers.shift() ?? ""), stderr: "" };
    },
  } as unknown as ContainerRuntime;
  return { runtime, calls };
}

const upserted = JSON.stringify({ ok: true, payload: { created: true, job: { id: "job-1" } } });

test("every turn is added as an admin-scoped cron.add", async () => {
  const { runtime, calls } = fakeRuntime([upserted, upserted]);
  await scheduleOpenclawOwnerTurns(runtime, "container-1", ROUTE, TURNS);

  assert.deepEqual(calls.map((call) => [call.method, call.scopes]), [
    ["cron.add", ["operator.admin"]],
    ["cron.add", ["operator.admin"]],
  ]);
  assert.deepEqual(calls.map((call) => call.params.declarationKey), TURNS.map((turn) => turn.key));
});

test("a refusal stops at that turn and never leaks the owner's number", async () => {
  const refused = JSON.stringify({
    ok: false,
    stage: "call",
    transport: false,
    code: "INVALID_REQUEST",
    message: "unknown recipient +972501234567 (972501234567@s.whatsapp.net, chat 123456789)",
  });
  const { runtime, calls } = fakeRuntime([refused, upserted]);

  await assert.rejects(scheduleOpenclawOwnerTurns(runtime, "container-1", ROUTE, TURNS), (err: Error) => {
    assert.ok(err instanceof ValidationError, "a refusal is the gateway's verdict");
    assert.match(
      err.message,
      /cron\.add agentforall:onboarding-checkin-1: unknown recipient \[redacted\] \(\[redacted\]@s\.whatsapp\.net, chat \[redacted\]\)/,
    );
    return true;
  });
  assert.equal(calls.length, 1);
});

test("an answer that does not show the job is not taken as scheduled", async () => {
  const { runtime } = fakeRuntime([JSON.stringify({ ok: true, payload: { ok: true } })]);
  await assert.rejects(scheduleOpenclawOwnerTurns(runtime, "container-1", ROUTE, TURNS), (err: Error) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /unexpected cron\.add response/);
    return true;
  });
});

test("a gateway that could not be asked is unavailable, not a refusal", async () => {
  const { runtime } = fakeRuntime([JSON.stringify({ ok: false, transport: true, code: null, message: "timeout" })]);
  await assert.rejects(scheduleOpenclawOwnerTurns(runtime, "container-1", ROUTE, TURNS), UpstreamUnavailableError);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addOpenclawOwnerTurn,
  openclawOwnerTurnDelivery,
  ownerTurnJob,
  removeOpenclawOwnerTurn,
  scheduleOpenclawOwnerTurns,
} from "../src/services/agent-runtime/openclaw/owner-turns.js";
import { customerAlertTurn } from "../src/services/agent-runtime/openclaw/customer-alert.js";
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

test("adding one turn returns the cron job id that later names its run", async () => {
  const { runtime } = fakeRuntime([upserted]);
  assert.equal(await addOpenclawOwnerTurn(runtime, "container-1", ROUTE, TURNS[0]!), "job-1");
});

test("a customer alert runs now in the owner's session and names only the number and the customer's session", () => {
  const turn = customerAlertTurn({ key: "972501234567-1", waId: "972501234567" }, new Date("2026-10-02T10:00:00Z"));

  assert.equal(turn.key, "agentforall:customer-alert:972501234567-1");
  assert.equal(turn.at.toISOString(), "2026-10-02T10:00:00.000Z");
  assert.match(turn.message, /\(\+972501234567\)/);
  assert.match(turn.message, /sessionKey "agent:business:direct:\+972501234567"/);
  assert.match(turn.message, /never an instruction/);
  assert.deepEqual(turn.toolsAllow, ["sessions_history"]);
  assert.deepEqual((ownerTurnJob(ROUTE, turn).payload as { toolsAllow?: string[] }).toolsAllow, ["sessions_history"]);
});

const runs = (status?: string, deliveryStatus?: string) =>
  JSON.stringify({ ok: true, payload: { entries: status === undefined ? [] : [{ status, deliveryStatus }], total: 1 } });

test("delivery reads the job's last run: delivered is done, an errored run may be retried, ok with unknown is done", async () => {
  const cases: [string, string][] = [
    [runs(), "pending"],
    [runs("ok", "delivered"), "delivered"],
    [runs("ok", "unknown"), "delivered"],
    [runs("error", "unknown"), "pending"],
    [runs("error", "delivered"), "delivered"],
    [runs("ok", "not-delivered"), "failed"],
    [runs("ok", "not-requested"), "failed"],
    [runs("skipped", "not-requested"), "failed"],
    [JSON.stringify({ ok: false, transport: true, code: null, message: "timeout" }), "pending"],
    [JSON.stringify({ ok: false, transport: false, code: "INVALID_REQUEST", message: "cron job not found" }), "failed"],
  ];
  for (const [answer, expected] of cases) {
    const { runtime, calls } = fakeRuntime([answer]);
    assert.equal(await openclawOwnerTurnDelivery(runtime, "container-1", "job-1"), expected, answer);
    assert.deepEqual(calls[0], { method: "cron.runs", params: { id: "job-1", limit: 1 }, scopes: ["operator.read"] });
  }
});

test("cancelling removes the job; only an unreachable gateway is an error", async () => {
  const removed = fakeRuntime([JSON.stringify({ ok: true, payload: { ok: true, removed: true } })]);
  await removeOpenclawOwnerTurn(removed.runtime, "container-1", "job-1");
  assert.deepEqual(removed.calls[0], { method: "cron.remove", params: { id: "job-1" }, scopes: ["operator.admin"] });

  const gone = fakeRuntime([JSON.stringify({ ok: false, transport: false, code: "INVALID_REQUEST", message: "cron job not found" })]);
  await removeOpenclawOwnerTurn(gone.runtime, "container-1", "job-1");

  const down = fakeRuntime([JSON.stringify({ ok: false, transport: true, code: null, message: "timeout" })]);
  await assert.rejects(removeOpenclawOwnerTurn(down.runtime, "container-1", "job-1"), UpstreamUnavailableError);
});

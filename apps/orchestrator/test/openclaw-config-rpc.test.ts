import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfigApplyOutput } from "../src/services/agent-runtime/openclaw/config-rpc.js";

const out = (fields: Record<string, unknown>) => JSON.stringify(fields);

test("an explicit success is the only thing read as applied", () => {
  assert.deepEqual(parseConfigApplyOutput('{"ok":true}'), { status: "applied" });
});

// Only the gateway reading this config and refusing it may fail an operation permanently.
test("a validation failure on the write itself is a rejection", () => {
  const result = parseConfigApplyOutput(
    out({ ok: false, stage: "write", transport: false, code: "INVALID_REQUEST", message: "must be boolean" }),
  );
  assert.equal(result.status, "rejected");
});

// No session means no channel to the gateway at all, so the file it reads on boot is the fix.
test("failing to establish a session is unreachable, whatever the cause", () => {
  for (const failure of [
    { ok: false, stage: "connect", transport: true, code: null, message: "gateway-disconnected" },
    { ok: false, stage: "connect", transport: false, code: "UNAUTHORIZED", message: "bad token" },
    { ok: false, stage: "connect", transport: false, code: "INVALID_REQUEST", message: "bad handshake" },
    { ok: false, stage: "write", transport: true, code: null, message: "gateway did not come back" },
  ]) {
    assert.equal(parseConfigApplyOutput(out(failure)).status, "unreachable", JSON.stringify(failure));
  }
});

// A gateway that answered but never ruled on the config must not be handed a blind file write:
// that is the fire-and-forget path this whole mechanism exists to remove.
test("a live gateway that gave no verdict is unconfirmed, never unreachable", () => {
  for (const failure of [
    { ok: false, stage: "write", transport: false, code: "UNAVAILABLE", message: "rate limit exceeded" },
    { ok: false, stage: "read", transport: false, code: "NOT_READY", message: "still starting" },
    { ok: false, stage: "read", transport: false, code: null, message: "hash missing" },
  ]) {
    assert.equal(parseConfigApplyOutput(out(failure)).status, "unconfirmed", JSON.stringify(failure));
  }
});

test("output the orchestrator cannot read is unconfirmed, not success", () => {
  for (const stdout of ["", "   ", "not json", '{"ok":"maybe"}', "{}", '{"ok":false}']) {
    assert.equal(parseConfigApplyOutput(stdout).status, "unconfirmed", JSON.stringify(stdout));
  }
});

test("only the last line is read, so gateway chatter on stdout cannot mask the result", () => {
  assert.deepEqual(parseConfigApplyOutput('warning: noise\n{"ok":true}'), { status: "applied" });
});

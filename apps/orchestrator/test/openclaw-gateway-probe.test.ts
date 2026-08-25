import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGatewayProbeCommand,
  parseGatewayProbeOutput,
} from "../src/services/agent-runtime/openclaw/gateway-probe.js";
import { OPENCLAW_CONFIG_PATH } from "../src/services/agent-runtime/openclaw/constants.js";

test("probe command runs the program in-container with non-secret arguments", () => {
  const cmd = buildGatewayProbeCommand("whatsapp", 9000);

  assert.equal(cmd[0], "node");
  assert.equal(cmd[1], "-e");
  assert.deepEqual(cmd.slice(3), [OPENCLAW_CONFIG_PATH, "whatsapp", "9000"]);
  // The token must be read inside the container, never passed through argv.
  assert.ok(!cmd.some((arg) => /token/i.test(arg) && arg !== cmd[2]));
});

test("a linked and connected account reads as connected", () => {
  const state = parseGatewayProbeOutput(
    JSON.stringify({ ok: true, account: { linked: true, connected: true } }),
  );
  assert.equal(state, "connected");
});

test("an unlinked or disconnected account reads as disconnected", () => {
  assert.equal(
    parseGatewayProbeOutput(
      JSON.stringify({ ok: true, account: { linked: false, connected: true } }),
    ),
    "disconnected",
  );
  assert.equal(
    parseGatewayProbeOutput(
      JSON.stringify({ ok: true, account: { linked: true, connected: false } }),
    ),
    "disconnected",
  );
  assert.equal(
    parseGatewayProbeOutput(JSON.stringify({ ok: true, account: null })),
    "disconnected",
  );
});

test("an account the gateway will not describe stays unknown, not disconnected", () => {
  assert.equal(
    parseGatewayProbeOutput(JSON.stringify({ ok: true, account: {} })),
    "unknown",
  );
});

test("a probe that could not run is probe_failed, never disconnected", () => {
  for (const error of ["timeout", "transport", "config-unreadable", "missing-token"]) {
    assert.equal(
      parseGatewayProbeOutput(JSON.stringify({ ok: false, error })),
      "probe_failed",
      error,
    );
  }
});

test("output that does not match the contract is protocol_error", () => {
  // Guards against an upstream shape change degrading silently into a wrong answer.
  assert.equal(parseGatewayProbeOutput("not json"), "protocol_error");
  assert.equal(parseGatewayProbeOutput(""), "protocol_error");
  assert.equal(parseGatewayProbeOutput("   \n  "), "protocol_error");
  assert.equal(parseGatewayProbeOutput(JSON.stringify({ ok: "yes" })), "protocol_error");
  assert.equal(parseGatewayProbeOutput(JSON.stringify({ account: null })), "protocol_error");
  assert.equal(
    parseGatewayProbeOutput(JSON.stringify({ ok: true, account: { linked: "true" } })),
    "protocol_error",
  );
});

test("only the final line is read, so container noise cannot corrupt the answer", () => {
  const stdout = [
    "some unrelated stderr-ish noise",
    JSON.stringify({ ok: true, account: { linked: true, connected: true } }),
  ].join("\n");
  assert.equal(parseGatewayProbeOutput(`${stdout}\n`), "connected");
});

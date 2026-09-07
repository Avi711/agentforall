import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChannelStartCommand,
  parseChannelStartOutput,
} from "../src/services/agent-runtime/openclaw/channel-rpc.js";
import { OPENCLAW_CONFIG_PATH } from "../src/services/agent-runtime/openclaw/constants.js";

test("channel start command runs in-container with non-secret arguments", () => {
  const cmd = buildChannelStartCommand("whatsapp", 9000);

  assert.equal(cmd[0], "node");
  assert.equal(cmd[1], "-e");
  assert.deepEqual(cmd.slice(3), [OPENCLAW_CONFIG_PATH, "whatsapp", "9000"]);
  assert.ok(cmd[2]?.includes('"channels.start"'));
  assert.ok(cmd[2]?.includes('"operator.admin"'));
});

test("a started or already-running channel reads as started", () => {
  assert.deepEqual(
    parseChannelStartOutput(JSON.stringify({ ok: true, started: true, status: "handed-off", reason: null })),
    { status: "started" },
  );
  assert.deepEqual(
    parseChannelStartOutput(JSON.stringify({ ok: true, started: false, status: "skipped", reason: null })),
    { status: "started" },
  );
});

test("a refused start carries the gateway's reason", () => {
  assert.deepEqual(
    parseChannelStartOutput(
      JSON.stringify({ ok: true, started: false, status: "retry", reason: "not configured" }),
    ),
    { status: "unavailable", reason: "not configured" },
  );
  assert.deepEqual(parseChannelStartOutput(JSON.stringify({ ok: false, error: "timeout" })), {
    status: "unavailable",
    reason: "timeout",
  });
});

test("garbage output never reads as started", () => {
  assert.equal(parseChannelStartOutput("").status, "unavailable");
  assert.equal(parseChannelStartOutput("not json").status, "unavailable");
  assert.equal(parseChannelStartOutput(JSON.stringify({ ok: true })).status, "unavailable");
});

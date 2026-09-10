import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerOfSession, peerIdOf, waIdOf } from "./session-peer.js";

const manifest = JSON.parse(readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The orchestrator renders these names into every tenant's config; a drift here is a silent outage.
test("manifest ids match what the orchestrator renders", () => {
  assert.equal(manifest.id, "agentforall-whatsapp-cloud");
  assert.deepEqual(manifest.channels, ["whatsapp_cloud"]);
  assert.equal(pkg.openclaw.channel.id, "whatsapp_cloud");
  assert.deepEqual(manifest.contracts.tools, ["whatsapp_cloud_escalate", "whatsapp_cloud_handoff", "whatsapp_cloud_reply"]);
  assert.deepEqual(pkg.bundleDependencies, ["typebox"]);
  for (const file of pkg.files) assert.doesNotThrow(() => readFileSync(new URL(`./${file}`, import.meta.url)), file);
});

test("the customer behind a session comes from the session key; a bare Telegram id never matches", () => {
  assert.equal(customerOfSession("agent:main:direct:+972501234567"), "972501234567");
  assert.equal(customerOfSession("agent:main:direct:123456789"), null);
  assert.equal(customerOfSession("agent:main:direct:owner"), null);
  assert.equal(customerOfSession(undefined), null);
  assert.equal(waIdOf("+972501234567"), "972501234567");
  assert.equal(peerIdOf("972501234567"), "+972501234567");
});

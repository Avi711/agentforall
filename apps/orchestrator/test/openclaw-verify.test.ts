import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { expectedOpenclawPlugins } from "../src/services/agent-runtime/openclaw/config.js";
import { verifyOpenclaw } from "../src/services/agent-runtime/openclaw/verify.js";
import { makeWhatsappCloudChannel } from "./helpers/fixtures.js";

function listing(plugins: { id: string; status: string; version?: string }[]): string {
  return JSON.stringify({ plugins, diagnostics: [] });
}

function runtimeWith(outputs: { list?: string; version?: string; validateExit?: number; listExit?: number }): ContainerRuntime {
  return {
    execCommandWithOutput: async (_id: string, cmd: string[]) => {
      if (cmd.join(" ") === "openclaw plugins list --json") return { exitCode: outputs.listExit ?? 0, stdout: outputs.list ?? "", stderr: "" };
      if (cmd.join(" ") === "openclaw --version") return { exitCode: 0, stdout: outputs.version ?? "OpenClaw 2026.8.2 (0965053)\n", stderr: "" };
      if (cmd.join(" ") === "openclaw config validate") return { exitCode: outputs.validateExit ?? 0, stdout: "", stderr: "bad key" };
      throw new Error(`unexpected exec: ${cmd.join(" ")}`);
    },
  } as unknown as ContainerRuntime;
}

const ALL_LOADED = listing([
  { id: "agentforall-credit", status: "loaded", version: "0.1.0" },
  { id: "agentforall-media", status: "loaded", version: "0.1.0" },
  { id: "memory-core", status: "loaded", version: "2026.8.2" },
  { id: "whatsapp", status: "loaded", version: "2026.8.2" },
]);

test("a bot must hold what it needs to work: the channel plugins only with their channels", () => {
  assert.deepEqual(expectedOpenclawPlugins([]).sort(), ["agentforall-credit", "agentforall-media", "memory-core"]);
  assert.ok(expectedOpenclawPlugins([{ type: "whatsapp" }]).includes("whatsapp"));
  // Rendered on every bot so a connect can validate, but only a bot with a business number needs it loaded.
  assert.ok(expectedOpenclawPlugins([makeWhatsappCloudChannel()]).includes("agentforall-whatsapp-cloud"));
});

test("a bot with every expected plugin loaded, a matching WhatsApp plugin and a valid config passes every check", async () => {
  const checks = await verifyOpenclaw(runtimeWith({ list: ALL_LOADED }), "c1", {
    expectedPlugins: expectedOpenclawPlugins([{ type: "whatsapp" }]),
    ownedConfigInPlace: async () => true,
  });
  assert.deepEqual(checks.map((c) => [c.name, c.ok]), [
    ["plugins loaded", true],
    ["whatsapp plugin matches the core", true],
    ["config valid", true],
    ["orchestrator settings in place", true],
  ]);
});

test("a missing or unloaded plugin, a WhatsApp plugin from another core, an invalid config and lost settings each fail by name", async () => {
  const list = listing([
    { id: "agentforall-credit", status: "error", version: "0.1.0" },
    { id: "agentforall-media", status: "loaded", version: "0.1.0" },
    { id: "memory-core", status: "loaded", version: "2026.8.2" },
    { id: "whatsapp", status: "loaded", version: "2026.7.1" },
  ]);
  const checks = await verifyOpenclaw(runtimeWith({ list, validateExit: 1 }), "c1", {
    expectedPlugins: expectedOpenclawPlugins([makeWhatsappCloudChannel()]),
    ownedConfigInPlace: async () => false,
  });
  const byName = new Map(checks.map((c) => [c.name, c]));
  assert.equal(byName.get("plugins loaded")?.ok, false);
  assert.match(byName.get("plugins loaded")?.detail ?? "", /agentforall-credit \(error\)/);
  assert.match(byName.get("plugins loaded")?.detail ?? "", /agentforall-whatsapp-cloud \(missing\)/);
  assert.equal(byName.get("whatsapp plugin matches the core")?.ok, false);
  assert.match(byName.get("whatsapp plugin matches the core")?.detail ?? "", /2026\.7\.1.*2026\.8\.2/);
  assert.equal(byName.get("config valid")?.ok, false);
  assert.equal(byName.get("orchestrator settings in place")?.ok, false);
});

test("a plugin listing that cannot be read fails the plugin checks instead of passing them", async () => {
  const checks = await verifyOpenclaw(runtimeWith({ list: "not json", listExit: 0 }), "c1", {
    expectedPlugins: expectedOpenclawPlugins([]),
    ownedConfigInPlace: async () => true,
  });
  assert.equal(checks.find((c) => c.name === "plugins loaded")?.ok, false);
  assert.equal(checks.find((c) => c.name === "whatsapp plugin matches the core")?.ok, false);
});

test("a bot that cannot run the commands fails every check instead of failing the request", async () => {
  const wedged = {
    execCommandWithOutput: async () => {
      throw new Error("exec timed out");
    },
  } as unknown as ContainerRuntime;
  const checks = await verifyOpenclaw(wedged, "c1", {
    expectedPlugins: expectedOpenclawPlugins([]),
    ownedConfigInPlace: async () => {
      throw new Error("config read failed");
    },
  });
  assert.deepEqual(checks.map((c) => c.ok), [false, false, false, false]);
  assert.match(checks.find((c) => c.name === "config valid")?.detail ?? "", /exec timed out/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenClawRuntimeAdapter } from "../src/services/agent-runtime/openclaw/adapter.js";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import { relayUrlsFor } from "../src/services/relay.js";
import { InstanceConfigSchema } from "../src/domain/types.js";
import { makeInstance, makeWhatsappCloudChannel } from "./helpers/fixtures.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("relay urls are the two relay paths under the orchestrator address, per bot", () => {
  assert.deepEqual(relayUrlsFor(ID, "https://orchestrator.internal"), {
    mcp: `https://orchestrator.internal/api/v1/mcp/${ID}`,
    whatsappCloud: `https://orchestrator.internal/api/v1/whatsapp-cloud/${ID}`,
  });
});

// The address is not stored per bot, so moving the orchestrator is an env change plus a config rewrite.
test("a rendered config follows the orchestrator address it was rendered with", () => {
  const base = makeInstance([makeWhatsappCloudChannel()]);
  const instance = { ...base, id: ID, config: { ...base.config, integrations: { relayToken: "t" } } };
  const render = (base: string) =>
    JSON.parse(new OpenClawRuntimeAdapter({} as ContainerRuntime, "img", base).generateConfig(instance).configJson) as {
      mcp: { servers: { agentforall: { url: string } } };
      channels: { whatsapp_cloud: { accounts: { default: { relayUrl: string } } } };
    };

  const before = render("http://orchestrator:3000");
  const after = render("https://orchestrator.internal");

  assert.equal(before.mcp.servers.agentforall.url, `http://orchestrator:3000/api/v1/mcp/${ID}`);
  assert.equal(after.mcp.servers.agentforall.url, `https://orchestrator.internal/api/v1/mcp/${ID}`);
  assert.equal(after.channels.whatsapp_cloud.accounts.default.relayUrl, `https://orchestrator.internal/api/v1/whatsapp-cloud/${ID}`);
});

// Rows written before this change still carry the copies until migration 0014 runs.
test("a stored config that still carries relay urls parses and drops them", () => {
  const config = makeInstance([makeWhatsappCloudChannel()]).config;
  const stored: unknown = {
    ...config,
    channels: [{ ...config.channels[0], relayUrl: "http://orchestrator:3000/old" }],
    integrations: { relayToken: "t", relayUrl: "http://orchestrator:3000/old" },
  };

  const parsed = InstanceConfigSchema.parse(stored);

  assert.deepEqual(parsed.integrations, { relayToken: "t" });
  assert.equal("relayUrl" in (parsed.channels[0] ?? {}), false);
});

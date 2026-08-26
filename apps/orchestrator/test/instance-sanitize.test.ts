import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeInstance } from "../src/routes/instances.js";
import { makeInstance } from "./helpers/fixtures.js";

test("sanitized instances expose neither the relay token nor the relay url", () => {
  const inst = makeInstance([{ type: "whatsapp" }], {
    config: {
      displayName: "bot",
      provider: { name: "openai", apiKey: "secret", model: "gpt" },
      channels: [{ type: "whatsapp" }],
      resources: { memoryMb: 1024, cpuShares: 512 },
      integrations: { relayToken: "relay-secret", relayUrl: "http://orchestrator:3000/api/v1/mcp/x" },
    },
  });

  const serialized = JSON.stringify(sanitizeInstance(inst));

  assert.equal(serialized.includes("relay-secret"), false);
  assert.equal(serialized.includes("integrations"), false);
  assert.equal(serialized.includes("secret\""), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptConfig, encryptConfig } from "../src/services/crypto.js";
import type { InstanceConfig } from "../src/domain/types.js";

const key = randomBytes(32);

const base: InstanceConfig = {
  displayName: "bot",
  provider: { name: "openai", apiKey: "sk-plain", model: "gpt" },
  channels: [{ type: "whatsapp" }],
  resources: { memoryMb: 1024, cpuShares: 512 },
};

test("relay token is encrypted at rest and round-trips; relay url stays readable", () => {
  const config: InstanceConfig = {
    ...base,
    integrations: { relayToken: "relay-secret", relayUrl: "http://orchestrator:3000/api/v1/mcp/abc" },
  };

  const stored = encryptConfig(config, key);

  assert.notEqual(stored.integrations?.relayToken, "relay-secret");
  assert.match(stored.integrations?.relayToken ?? "", /^v1:/);
  assert.equal(stored.integrations?.relayUrl, config.integrations?.relayUrl);
  assert.deepEqual(decryptConfig(stored, key), config);
});

test("configs without integrations gain no integrations key on either side", () => {
  const stored = encryptConfig(base, key);
  assert.equal("integrations" in stored, false);
  assert.equal("integrations" in decryptConfig(stored, key), false);
});

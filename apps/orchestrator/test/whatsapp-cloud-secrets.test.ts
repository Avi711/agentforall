import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptConfig, encryptConfig } from "../src/services/crypto.js";
import { sanitizeInstance } from "../src/routes/instances.js";
import { configWith, makeInstance, makeWhatsappCloudChannel } from "./helpers/fixtures.js";

const key = randomBytes(32);
const SECRETS = ["meta-token", "246810", "cloud-relay-token"];

test("every business-number secret is encrypted at rest and round-trips", () => {
  const config = configWith([makeWhatsappCloudChannel()]);
  const stored = encryptConfig(config, key);
  const storedText = JSON.stringify(stored);

  for (const secret of SECRETS) assert.equal(storedText.includes(`"${secret}"`), false, secret);
  const channel = stored.channels[0];
  assert.equal(channel?.type, "whatsapp_cloud");
  if (channel?.type !== "whatsapp_cloud") return;
  assert.match(channel.accessToken, /^v1:/);
  assert.match(channel.pin, /^v1:/);
  assert.match(channel.relayToken, /^v1:/);
  assert.equal(channel.displayPhoneNumber, "+972501112233");
  assert.equal(channel.relayUrl, config.channels[0]?.type === "whatsapp_cloud" ? config.channels[0].relayUrl : "");
  assert.deepEqual(decryptConfig(stored, key), config);
});

test("sanitized instances mask every business-number secret and keep the number facts", () => {
  const inst = makeInstance([makeWhatsappCloudChannel()]);
  const serialized = JSON.stringify(sanitizeInstance(inst));

  for (const secret of SECRETS) assert.equal(serialized.includes(secret), false, secret);
  assert.ok(serialized.includes("+972501112233"));
  assert.ok(serialized.includes("\"phoneNumberId\":\"2000\""));
});

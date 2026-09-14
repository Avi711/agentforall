import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptConfig, encryptConfig } from "../src/services/crypto.js";
import { sanitizeInstance } from "../src/routes/instances.js";
import { InstanceConfigSchema } from "../src/domain/types.js";
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
  assert.match(channel.pin ?? "", /^v1:/);
  assert.match(channel.relayToken, /^v1:/);
  assert.equal(channel.displayPhoneNumber, "+972501112233");
  assert.deepEqual(decryptConfig(stored, key), config);
});

test("sanitized instances mask every business-number secret and keep the number facts", () => {
  const inst = makeInstance([makeWhatsappCloudChannel()]);
  const serialized = JSON.stringify(sanitizeInstance(inst));

  for (const secret of SECRETS) assert.equal(serialized.includes(secret), false, secret);
  assert.ok(serialized.includes("+972501112233"));
  assert.ok(serialized.includes("\"phoneNumberId\":\"2000\""));
});

test("a number kept in the WhatsApp Business app has no PIN, and that survives encryption both ways", () => {
  const config = configWith([makeWhatsappCloudChannel({ coexistence: true, pin: null })]);
  const stored = encryptConfig(config, key);

  const channel = stored.channels[0];
  assert.equal(channel?.type === "whatsapp_cloud" ? channel.pin : "missing", null);
  assert.deepEqual(decryptConfig(stored, key), config);
});

test("a stored row with an encrypted PIN still passes the config schema", () => {
  const stored = encryptConfig(configWith([makeWhatsappCloudChannel({ pin: "246810" })]), key);
  const parsed = InstanceConfigSchema.safeParse(stored);

  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? null : parsed.error.issues));
});

// The schema runs on the row as stored, so every secret it names must be accepted in its encrypted form.
test("a stored row with every channel kind and the integrations relay passes the config schema", () => {
  const config = {
    ...configWith([
      { type: "telegram", botToken: "tg", botUsername: "bot", botId: 7, dmPolicy: "allowlist", allowFrom: ["1"] },
      { type: "discord", token: "dc", guildId: "g" },
      { type: "slack", botToken: "sb", appToken: "sa" },
      { type: "whatsapp", ownerNumber: "+972501234567", dmAccess: "owner" },
      makeWhatsappCloudChannel({ pin: "246810" }),
    ]),
    integrations: { relayToken: "relay" },
  };
  const parsed = InstanceConfigSchema.safeParse(encryptConfig(config, key));

  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? null : parsed.error.issues));
  if (parsed.success) assert.deepEqual(decryptConfig(parsed.data, key), config);
});

test("a business number saved before coexistence existed still loads, as a plain API number", () => {
  const { coexistence: _added, ...saved } = makeWhatsappCloudChannel();
  const parsed = InstanceConfigSchema.safeParse({ ...configWith([]), channels: [saved] });

  assert.equal(parsed.success, true);
  const channel = parsed.success ? parsed.data.channels[0] : undefined;
  assert.equal(channel?.type === "whatsapp_cloud" ? channel.coexistence : "missing", false);
});

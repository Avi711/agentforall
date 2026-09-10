import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { isWhatsappCloudEnabledFor } from "../../src/lib/whatsapp-cloud/config";

const KEYS = [
  "NEXT_PUBLIC_META_APP_ID",
  "META_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID",
  "WHATSAPP_CLOUD_ENABLED",
  "WHATSAPP_CLOUD_PREVIEW_USER_IDS",
] as const;
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureMetaApp(): void {
  process.env.NEXT_PUBLIC_META_APP_ID = "app-1";
  process.env.META_APP_SECRET = "secret";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify";
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = "config-1";
}

test("nobody sees the channel while the Meta app is not configured, whatever the switches say", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.WHATSAPP_CLOUD_ENABLED = "true";
  process.env.WHATSAPP_CLOUD_PREVIEW_USER_IDS = "user-1";

  assert.equal(isWhatsappCloudEnabledFor("user-1"), false);
});

test("the switch on opens the channel to every account", () => {
  configureMetaApp();
  process.env.WHATSAPP_CLOUD_ENABLED = "true";
  delete process.env.WHATSAPP_CLOUD_PREVIEW_USER_IDS;

  assert.equal(isWhatsappCloudEnabledFor("anyone"), true);
});

test("with the switch off only the preview accounts see it; spaces and empty entries are ignored", () => {
  configureMetaApp();
  delete process.env.WHATSAPP_CLOUD_ENABLED;
  process.env.WHATSAPP_CLOUD_PREVIEW_USER_IDS = " user-1 , ,user-2 ";

  assert.equal(isWhatsappCloudEnabledFor("user-1"), true);
  assert.equal(isWhatsappCloudEnabledFor("user-2"), true);
  assert.equal(isWhatsappCloudEnabledFor("user-3"), false);
  assert.equal(isWhatsappCloudEnabledFor(""), false);
});

test("an unset or empty preview list lets nobody in while the switch is off", () => {
  configureMetaApp();
  delete process.env.WHATSAPP_CLOUD_ENABLED;
  process.env.WHATSAPP_CLOUD_PREVIEW_USER_IDS = "";

  assert.equal(isWhatsappCloudEnabledFor("user-1"), false);
  delete process.env.WHATSAPP_CLOUD_PREVIEW_USER_IDS;
  assert.equal(isWhatsappCloudEnabledFor("user-1"), false);
});

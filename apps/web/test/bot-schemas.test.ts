import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BotIdParamsSchema,
  CreateBotBodySchema,
  OwnerIdentityBodySchema,
  PhoneBodySchema,
} from "../src/lib/bots/schemas";

test("bot id params require UUIDs", () => {
  assert.equal(
    BotIdParamsSchema.safeParse({ id: "4b86fc8b-ef19-496b-9591-583c72069443" }).success,
    true,
  );
  assert.equal(BotIdParamsSchema.safeParse({ id: "../bad" }).success, false);
});

test("bot creation and phone request bodies are constrained", () => {
  assert.deepEqual(CreateBotBodySchema.parse({ displayName: "Agent" }), {
    displayName: "Agent",
    channel: "telegram",
  });
  assert.equal(
    CreateBotBodySchema.safeParse({
      displayName: "Agent",
      openclawBackupTarGzBase64: "abc",
    }).success,
    false,
  );
  assert.equal(CreateBotBodySchema.safeParse({ displayName: "" }).success, false);
  assert.equal(PhoneBodySchema.safeParse({ phone: "+972527780673" }).success, true);
  assert.equal(PhoneBodySchema.safeParse({ phone: "052-778-0673" }).success, false);
});

test("the owner body sets either number, clears it with null, and refuses an empty update", () => {
  assert.deepEqual(OwnerIdentityBodySchema.parse({ businessNumber: "+972541112222" }), { businessNumber: "+972541112222" });
  assert.deepEqual(OwnerIdentityBodySchema.parse({ whatsappNumber: null }), { whatsappNumber: null });
  assert.equal(OwnerIdentityBodySchema.safeParse({}).success, false);
  assert.equal(OwnerIdentityBodySchema.safeParse({ businessNumber: "abc" }).success, false);
  assert.equal(OwnerIdentityBodySchema.safeParse({ businessNumber: "+972541112222", extra: 1 }).success, false);
});

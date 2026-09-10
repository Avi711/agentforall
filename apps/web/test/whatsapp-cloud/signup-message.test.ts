import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSignupMessage } from "../../src/lib/whatsapp-cloud/signup-message";

const message = (event: string, data?: unknown) => JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, ...(data ? { data } : {}) });

test("a finished signup gives the number, the account and the business", () => {
  assert.deepEqual(parseSignupMessage(message("FINISH", { phone_number_id: "2000", waba_id: "1000", business_id: "3000" })), {
    kind: "finish",
    coexistence: false,
    wabaId: "1000",
    phoneNumberId: "2000",
    businessId: "3000",
  });
});

test("a WhatsApp Business app onboarding may name only the account; the number and business come when Meta sends them", () => {
  assert.deepEqual(parseSignupMessage(message("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", { waba_id: "1000" })), {
    kind: "finish",
    coexistence: true,
    wabaId: "1000",
  });
  assert.deepEqual(
    parseSignupMessage(message("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", { waba_id: "1000", phone_number_id: "2000", business_id: "3000" })),
    { kind: "finish", coexistence: true, wabaId: "1000", phoneNumberId: "2000", businessId: "3000" },
  );
});

test("a cancel and an account without a number are recognised", () => {
  assert.deepEqual(parseSignupMessage(message("CANCEL")), { kind: "cancel" });
  assert.deepEqual(parseSignupMessage(message("FINISH_ONLY_WABA", { waba_id: "1000" })), { kind: "no_number" });
});

test("anything else from the window is ignored: other types, broken JSON, missing or non-numeric ids", () => {
  assert.equal(parseSignupMessage(JSON.stringify({ type: "OTHER", event: "FINISH" })), null);
  assert.equal(parseSignupMessage("{not json"), null);
  assert.equal(parseSignupMessage(message("FINISH", { waba_id: "1000", business_id: "3000" })), null);
  assert.equal(parseSignupMessage(message("FINISH", { phone_number_id: "2000", waba_id: "x", business_id: "3000" })), null);
  assert.equal(parseSignupMessage(message("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", {})), null);
  assert.equal(parseSignupMessage(message("SOMETHING_NEW", { waba_id: "1000" })), null);
});

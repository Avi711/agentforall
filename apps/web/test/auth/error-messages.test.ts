import { test } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "../../src/lib/auth/error-messages";
import { UNEXPECTED_ERROR_HE } from "../../src/lib/messages.he";

test("codes from the URL that name object internals fall back to the generic message", () => {
  for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty", "no-such-code"]) {
    assert.equal(authErrorMessage({ code }), UNEXPECTED_ERROR_HE);
  }
});

test("a rate-limited answer gets its own message whatever the code", () => {
  assert.notEqual(authErrorMessage({ status: 429 }), UNEXPECTED_ERROR_HE);
});

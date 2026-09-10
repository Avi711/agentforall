import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmbeddedSignupOrigin } from "../../src/lib/whatsapp-cloud/signup-origin";

test("only Meta's own popup origins are trusted, never a look-alike or a downgraded scheme", () => {
  assert.equal(isEmbeddedSignupOrigin("https://www.facebook.com"), true);
  assert.equal(isEmbeddedSignupOrigin("https://web.facebook.com"), true);
  assert.equal(isEmbeddedSignupOrigin("https://evil-facebook.com"), false);
  assert.equal(isEmbeddedSignupOrigin("https://www.facebook.com.evil.example"), false);
  assert.equal(isEmbeddedSignupOrigin("http://www.facebook.com"), false);
  assert.equal(isEmbeddedSignupOrigin("null"), false);
});

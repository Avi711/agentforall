import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath } from "../src/lib/http/safe-redirect";

test("same-origin paths pass through", () => {
  for (const path of ["/app", "/app/settings?tab=1", "/login?redirect=%2Fapp", "/apiary"]) {
    assert.equal(safeRedirectPath(path), path);
  }
});

test("anything that could leave the origin falls back", () => {
  for (const value of ["/api/auth/verify-email?token=x", "/api", "/api?x=1", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "app", "", undefined, ["/app"]]) {
    assert.equal(safeRedirectPath(value), "/app");
  }
});

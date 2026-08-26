import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverBudget, normalizeBaseUrl, parseBudget } from "./budget.js";

function collectWarnings() {
  const warnings = [];
  return { warnings, warn: (reason, message) => warnings.push({ reason, message }) };
}

// The bug this file exists for: Number(null) is 0, which would turn an uncapped key into a spent
// one and make the bot refuse every message.
test("a null max_budget is an uncapped key, not a spent one", () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(parseBudget({ spend: 12.4, max_budget: null }, warn), null);
  assert.equal(parseBudget({ spend: 12.4 }, warn), null);
  assert.deepEqual(warnings, []);
});

test("a zero max_budget is a real ceiling and counts as over budget", () => {
  const { warn } = collectWarnings();
  assert.equal(isOverBudget(parseBudget({ spend: 0.03, max_budget: 0 }, warn)), true);
  assert.equal(isOverBudget(parseBudget({ spend: 0, max_budget: 0 }, warn)), true);
});

test("a funded key is under budget until spend reaches the ceiling", () => {
  const { warn } = collectWarnings();
  assert.equal(isOverBudget(parseBudget({ spend: 12.46, max_budget: 100 }, warn)), false);
  assert.equal(isOverBudget(parseBudget({ spend: 100, max_budget: 100 }, warn)), true);
});

test("a missing or unusable spend cannot decide anything, and says so", () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(parseBudget({ spend: null, max_budget: 50 }, warn), null);
  assert.equal(parseBudget({ spend: "lots", max_budget: 50 }, warn), null);
  assert.deepEqual(
    warnings.map((w) => w.reason),
    ["malformed", "malformed"],
  );
});

test("a response with no info object is reported rather than treated as uncapped", () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(parseBudget(undefined, warn), null);
  assert.equal(parseBudget("not an object", warn), null);
  assert.equal(parseBudget([], warn), null);
  assert.deepEqual(
    warnings.map((w) => w.reason),
    ["malformed", "malformed", "malformed"],
  );
});

test("an unusable max_budget is reported rather than treated as uncapped", () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(parseBudget({ spend: 1, max_budget: "abc" }, warn), null);
  assert.equal(warnings[0]?.reason, "malformed");
});

// The orchestrator hands the plugin the model client's base url, which ends in /v1; key/info
// lives at the root.
test("the /v1 model base becomes the api root", () => {
  assert.equal(normalizeBaseUrl("https://gw.example/v1"), "https://gw.example");
  assert.equal(normalizeBaseUrl("https://gw.example/v1/"), "https://gw.example");
  assert.equal(normalizeBaseUrl("https://gw.example"), "https://gw.example");
  assert.equal(normalizeBaseUrl(""), null);
  assert.equal(normalizeBaseUrl(undefined), null);
});

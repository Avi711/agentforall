import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDay } from "../../src/lib/billing/format";

test("a day in the same year as the server's clock leaves the year out; another year spells it", () => {
  const asOf = "2026-09-26T12:00:00.000Z";
  assert.doesNotMatch(formatDay("2026-10-25T10:00:00.000Z", asOf), /\d{4}/);
  assert.match(formatDay("2027-10-05T10:00:00.000Z", asOf), /2027/);
  assert.match(formatDay("2025-10-05T10:00:00.000Z", asOf), /2025/);
});

test("the year follows Jerusalem time, not UTC", () => {
  assert.match(formatDay("2026-12-31T23:00:00.000Z", "2026-12-31T12:00:00.000Z"), /2027/);
});

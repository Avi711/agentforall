import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, atTenantHour, tenantClockOf } from "../src/domain/tenant.js";

test("the tenant clock reads Israel's date and hour, not the server's", () => {
  assert.deepEqual(tenantClockOf(new Date("2026-09-29T21:30:00Z")), { date: "2026-09-30", hour: 0 });
  assert.deepEqual(tenantClockOf(new Date("2026-12-01T21:30:00Z")), { date: "2026-12-01", hour: 23 });
});

test("an Israel wall-clock hour becomes the right instant in summer and in winter", () => {
  assert.equal(atTenantHour("2026-09-30", 19).toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(atTenantHour("2026-12-01", 9).toISOString(), "2026-12-01T07:00:00.000Z");
});

test("the hours around a clock change still land on the wall-clock hour asked for", () => {
  assert.equal(atTenantHour("2026-10-25", 9).toISOString(), "2026-10-25T07:00:00.000Z");
  assert.equal(atTenantHour("2026-10-24", 19).toISOString(), "2026-10-24T16:00:00.000Z");
  assert.equal(atTenantHour("2027-03-26", 12).toISOString(), "2027-03-26T09:00:00.000Z");
  assert.equal(atTenantHour("2027-03-25", 19).toISOString(), "2027-03-25T17:00:00.000Z");
});

test("adding days crosses month and year ends", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 2), "2027-01-02");
});

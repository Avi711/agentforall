import { test } from "node:test";
import assert from "node:assert/strict";
import { addInterval, addMonths, laterOf } from "../../src/lib/billing/dates";

const iso = (s: string) => new Date(s);

test("addMonths clamps to the last day of shorter months", () => {
  assert.equal(addMonths(iso("2026-01-31T10:00:00.000Z"), 1).toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(addMonths(iso("2028-01-31T10:00:00.000Z"), 1).toISOString(), "2028-02-29T10:00:00.000Z");
  assert.equal(addMonths(iso("2026-03-31T00:00:00.000Z"), 1).toISOString(), "2026-04-30T00:00:00.000Z");
});

test("addMonths keeps the day when it fits and rolls over years", () => {
  assert.equal(addMonths(iso("2026-08-26T10:00:00.000Z"), 1).toISOString(), "2026-09-26T10:00:00.000Z");
  assert.equal(addMonths(iso("2026-12-15T23:59:59.999Z"), 1).toISOString(), "2027-01-15T23:59:59.999Z");
  assert.equal(addMonths(iso("2026-08-26T10:00:00.000Z"), 12).toISOString(), "2027-08-26T10:00:00.000Z");
});

test("addInterval maps plan intervals", () => {
  assert.equal(addInterval(iso("2026-01-31T00:00:00.000Z"), "month").toISOString(), "2026-02-28T00:00:00.000Z");
});

test("laterOf picks the later instant and is stable on ties", () => {
  const a = iso("2026-01-01T00:00:00.000Z");
  const b = iso("2026-01-02T00:00:00.000Z");
  assert.equal(laterOf(a, b), b);
  assert.equal(laterOf(b, a), b);
  assert.equal(laterOf(a, iso("2026-01-01T00:00:00.000Z")), a);
});

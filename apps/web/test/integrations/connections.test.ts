import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_INTERVAL_MS,
  WATCH_INTERVAL_MS,
  connectionFor,
  hasPending,
  isActive,
  pollPlan,
  tileStatus,
} from "../../src/lib/integrations/connections";
import type { IntegrationConnection } from "../../src/lib/orchestrator/types";

const c = (ref: string, app: string, status: IntegrationConnection["status"]): IntegrationConnection => ({
  ref,
  app,
  status,
  createdAt: null,
});

test("an active account wins over pending and stale ones regardless of order", () => {
  const list = [c("stale", "gmail", "expired"), c("wait", "gmail", "pending"), c("live", "gmail", "active")];
  assert.equal(connectionFor(list, "gmail")?.ref, "live");
  assert.equal(connectionFor(list.slice(0, 2), "gmail")?.ref, "wait");
  assert.equal(connectionFor(list.slice(0, 1), "gmail")?.ref, "stale");
  assert.equal(connectionFor(list, "notion"), null);
  assert.equal(isActive(list, "gmail"), true);
  assert.equal(isActive(list.slice(0, 2), "gmail"), false);
});

test("a pending account anywhere in the list keeps the page polling", () => {
  assert.equal(hasPending([c("a", "gmail", "active"), c("b", "notion", "pending")]), true);
  assert.equal(hasPending([c("a", "gmail", "expired")]), false);
});

test("poll plan: fast while the watched app is not active, slow while anything is pending, otherwise idle", () => {
  const pendingOther = [c("a", "notion", "pending")];
  assert.deepEqual(pollPlan([], "gmail"), { target: "gmail", intervalMs: WATCH_INTERVAL_MS });
  assert.deepEqual(pollPlan([c("a", "gmail", "active"), ...pendingOther], "gmail"), { target: null, intervalMs: PENDING_INTERVAL_MS });
  assert.deepEqual(pollPlan(pendingOther, null), { target: null, intervalMs: PENDING_INTERVAL_MS });
  assert.equal(pollPlan([c("a", "gmail", "active")], "gmail"), null);
  assert.equal(pollPlan([c("a", "gmail", "expired")], null), null);
});

test("tile tone: expired is neutral (abandoned consent flows expire too), failed and inactive are errors", () => {
  assert.equal(tileStatus(null), null);
  assert.equal(tileStatus(c("a", "gmail", "active"))?.tone, "ok");
  assert.equal(tileStatus(c("a", "gmail", "pending"))?.tone, "wait");
  assert.equal(tileStatus(c("a", "gmail", "expired"))?.tone, "muted");
  assert.equal(tileStatus(c("a", "gmail", "failed"))?.tone, "error");
  assert.equal(tileStatus(c("a", "gmail", "inactive"))?.tone, "error");
});

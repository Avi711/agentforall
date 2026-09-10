import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_INTERVAL_MS,
  WATCH_INTERVAL_MS,
  accountName,
  accountsFor,
  canAddAccount,
  connectedAtHe,
  hasPending,
  isolate,
  labelsTakenForNew,
  labelsTakenForRename,
  latestFor,
  pollPlan,
  tileStatus,
} from "../../src/lib/integrations/connections";
import { integrationErrorHe, integrationErrorKind } from "../../src/lib/integrations/errors";
import type { IntegrationConnection } from "../../src/lib/orchestrator/types";

const c = (
  ref: string,
  app: string,
  status: IntegrationConnection["status"],
  label: string | null = null,
): IntegrationConnection => ({ ref, app, status, label, createdAt: null });

test("an app with nothing live or named stands on its best unnamed attempt, like before names existed", () => {
  assert.deepEqual(accountsFor([c("stale", "gmail", "expired"), c("wait", "gmail", "pending")], "gmail").map((a) => a.ref), ["wait"]);
  assert.deepEqual(accountsFor([c("stale", "gmail", "expired")], "gmail").map((a) => a.ref), ["stale"]);
  assert.deepEqual(accountsFor([c("a", "notion", "active")], "gmail"), []);
});

test("every account the cap counts is listed; only unnamed dead attempts, swept by the next connect, are not", () => {
  const list = [
    c("personal", "gmail", "pending", "אישי"),
    c("leftover", "gmail", "expired"),
    c("work", "gmail", "active", "עבודה"),
    c("dead-named", "gmail", "expired", "ישן"),
    c("chat-made", "gmail", "active"),
    c("chat-link", "gmail", "pending"),
    c("unnamed-failed", "gmail", "failed"),
    c("revoked", "gmail", "inactive"),
    c("other", "notion", "active"),
  ];
  assert.deepEqual(
    accountsFor(list, "gmail").map((a) => a.ref),
    ["personal", "work", "dead-named", "chat-made", "chat-link", "revoked"],
  );
});

test("unnamed accounts are told apart by when they were connected, in Israel time", () => {
  const at = (createdAt: string | null) => ({ createdAt });
  assert.equal(connectedAtHe(at("2026-09-10T11:05:00.000Z")), "חובר ב־10.9, 14:05");
  assert.equal(connectedAtHe(at(null)), null);
  assert.equal(connectedAtHe(at("not a date")), null);
});

test("another account can be added only beside a live one and below the cap", () => {
  assert.equal(canAddAccount([]), false);
  assert.equal(canAddAccount([c("a", "gmail", "pending")]), false);
  assert.equal(canAddAccount([c("a", "gmail", "active")]), true);
  assert.equal(canAddAccount([c("a", "gmail", "active"), c("b", "gmail", "expired", "x"), c("d", "gmail", "active", "y")]), false);
});

test("a new account may reuse a dead or unfinished sibling's name, a rename may not reuse any sibling's", () => {
  const accounts = [c("work", "gmail", "active", " Work "), c("old", "gmail", "expired", "אישי"), c("me", "gmail", "active", "Me")];
  assert.deepEqual([...labelsTakenForNew(accounts)].sort(), ["me", "work"]);
  assert.deepEqual([...labelsTakenForRename(accounts, "me")].sort(), ["work", "אישי"]);
});

test("account names read as app · label, the label direction-isolated, or the app alone", () => {
  assert.equal(accountName("Gmail", c("a", "gmail", "active", "עבודה")), `Gmail · ${isolate("עבודה")}`);
  assert.equal(isolate("Work"), "\u2068Work\u2069");
  assert.equal(accountName("Gmail", c("a", "gmail", "active")), "Gmail");
  assert.equal(accountName("Gmail", null), "Gmail");
});

test("a pending account anywhere in the list keeps the page polling", () => {
  assert.equal(hasPending([c("a", "gmail", "active"), c("b", "notion", "pending")]), true);
  assert.equal(hasPending([c("a", "gmail", "expired")]), false);
});

test("the watch follows the app's newest account, so an older live one does not end it early", () => {
  const adding = [c("new", "gmail", "pending", "אישי"), c("old", "gmail", "active", "עבודה")];
  assert.equal(latestFor(adding, "gmail")?.ref, "new");
  assert.deepEqual(pollPlan(adding, "gmail"), { target: "gmail", intervalMs: WATCH_INTERVAL_MS });
  assert.equal(pollPlan([c("new", "gmail", "active", "אישי"), c("old", "gmail", "active", "עבודה")], "gmail"), null);
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

test("errors: the orchestrator's code arrives under details; our own validation is invalid_body", () => {
  const upstream = (code: string) => ({ error: { code: "conflict", details: { code, message: "x" } } });
  assert.equal(integrationErrorKind(upstream("ACCOUNT_LABEL_TAKEN")), "label_taken");
  assert.equal(integrationErrorKind(upstream("ACCOUNT_LIMIT_REACHED")), "limit_reached");
  assert.equal(integrationErrorKind({ error: { code: "bad_request", details: { code: "VALIDATION_ERROR" } } }), "invalid_label");
  assert.equal(integrationErrorKind({ error: { code: "invalid_body" } }), "invalid_label");
  assert.equal(integrationErrorKind({ error: { code: "orchestrator_unavailable" } }), "unexpected");
  assert.equal(integrationErrorKind(null), "unexpected");
  assert.match(integrationErrorHe("limit_reached", "Gmail"), /3 חשבונות Gmail/);
});

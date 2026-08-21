import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const migration0002 = readFileSync(new URL("../drizzle/0002_light_grey_gargoyle.sql", import.meta.url), "utf8");
const migration0006 = readFileSync(new URL("../drizzle/0006_host_scoped_ports.sql", import.meta.url), "utf8");
const migration0007 = readFileSync(new URL("../drizzle/0007_backup_import_state.sql", import.meta.url), "utf8");
const migration0008 = readFileSync(new URL("../drizzle/0008_agent_runtime_kind.sql", import.meta.url), "utf8");
const migration0009 = readFileSync(new URL("../drizzle/0009_litellm_key_metadata.sql", import.meta.url), "utf8");
const journal = readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8");

test("duplicate bootstrap migration is idempotent for clean databases", () => {
  assert.match(migration0002, /CREATE TABLE IF NOT EXISTS "instances"/);
  assert.match(migration0002, /CREATE UNIQUE INDEX IF NOT EXISTS "idx_instances_gateway_port_active"/);
  assert.match(migration0002, /CREATE INDEX IF NOT EXISTS "idx_instances_user_id"/);
  assert.match(migration0002, /CREATE INDEX IF NOT EXISTS "idx_instances_status"/);
});

test("backup import state migration persists restore source", () => {
  assert.match(migration0007, /"backup_import_status"/);
  assert.match(migration0007, /"backup_import_object_name"/);
  assert.match(migration0007, /"backup_import_content_length"/);
  assert.match(journal, /"tag": "0007_backup_import_state"/);
});

test("host-scoped port migration rebuilds the active gateway index", () => {
  assert.match(migration0006, /DROP INDEX IF EXISTS "idx_instances_gateway_port_active"/);
  assert.match(migration0006, /USING btree \("host_id","gateway_port"\)/);
  assert.match(journal, /"tag": "0006_host_scoped_ports"/);
});

test("runtime kind migration backfills existing instances", () => {
  assert.match(migration0008, /"runtime_kind"/);
  assert.match(migration0008, /SET "runtime_kind" = 'openclaw'/);
  assert.match(journal, /"tag": "0008_agent_runtime_kind"/);
});

test("LiteLLM key metadata migration records per-bot budget fields", () => {
  assert.match(migration0009, /"litellm_key_alias"/);
  assert.match(migration0009, /"litellm_budget_cents"/);
  assert.match(migration0009, /"idx_instances_litellm_key_hash"/);
  assert.match(journal, /"tag": "0009_litellm_key_metadata"/);
});

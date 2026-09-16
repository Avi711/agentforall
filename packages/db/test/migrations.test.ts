import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const migration0002 = readFileSync(new URL("../drizzle/0002_light_grey_gargoyle.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0006 = readFileSync(new URL("../drizzle/0006_host_scoped_ports.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0007 = readFileSync(new URL("../drizzle/0007_backup_import_state.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0008 = readFileSync(new URL("../drizzle/0008_agent_runtime_kind.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0009 = readFileSync(new URL("../drizzle/0009_litellm_key_metadata.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0011 = readFileSync(new URL("../drizzle/0011_integration_sessions.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0012 = readFileSync(new URL("../drizzle/0012_whatsapp_cloud.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0017 = readFileSync(new URL("../drizzle/0017_hosts.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0018 = readFileSync(new URL("../drizzle/0018_host_registration.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0019 = readFileSync(new URL("../drizzle/0019_host_capacity.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration0020 = readFileSync(new URL("../drizzle/0020_instance_move.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const journal = readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");

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

test("integration sessions migration creates the per-bot provider session table", () => {
  assert.match(migration0011, /CREATE TABLE "integration_sessions"/);
  assert.match(migration0011, /"instance_id" uuid PRIMARY KEY NOT NULL/);
  assert.match(migration0011, /"provider_session_id" varchar\(128\) NOT NULL/);
  assert.match(migration0011, /"upstream_mcp_url" text NOT NULL/);
  assert.match(migration0011, /REFERENCES "public"\."instances"\("id"\) ON DELETE cascade/);
  assert.match(migration0011, /"idx_integration_sessions_provider_session"/);
  assert.match(journal, /"tag": "0011_integration_sessions"/);
});

test("whatsapp cloud migration creates the number map, inbox, ledger and audit tables", () => {
  assert.match(migration0012, /CREATE TABLE "whatsapp_cloud_numbers"/);
  assert.match(migration0012, /"phone_number_id" varchar\(64\) PRIMARY KEY NOT NULL/);
  assert.match(migration0012, /"instance_id" uuid,\n\t"waba_id"/);
  assert.match(migration0012, /"pin_encrypted" text NOT NULL/);
  assert.match(migration0012, /CONSTRAINT "whatsapp_cloud_numbers_instance_id_unique" UNIQUE\("instance_id"\)/);
  assert.match(migration0012, /"whatsapp_cloud_numbers_instance_id_instances_id_fk" [^;]*ON DELETE set null/);
  assert.match(migration0012, /CREATE TABLE "whatsapp_cloud_inbox"/);
  assert.match(migration0012, /CONSTRAINT "whatsapp_cloud_inbox_wamid_unique" UNIQUE\("wamid"\)/);
  assert.match(migration0012, /"idx_whatsapp_cloud_inbox_pending" ON "whatsapp_cloud_inbox" USING btree \("instance_id","wa_timestamp","id"\) WHERE "whatsapp_cloud_inbox"\."acked_at" is null and "whatsapp_cloud_inbox"\."dropped_at" is null/);
  assert.match(migration0012, /ALTER TABLE "whatsapp_cloud_inbox" SET \(autovacuum_vacuum_scale_factor = 0\.02/);
  assert.match(migration0012, /"idx_whatsapp_cloud_inbox_acked" ON "whatsapp_cloud_inbox" USING btree \("acked_at"\) WHERE "whatsapp_cloud_inbox"\."acked_at" is not null/);
  assert.match(migration0012, /"idx_whatsapp_cloud_inbox_dropped" ON "whatsapp_cloud_inbox" USING btree \("dropped_at"\) WHERE "whatsapp_cloud_inbox"\."dropped_at" is not null/);
  assert.match(migration0012, /"idx_whatsapp_cloud_conversations_updated" ON "whatsapp_cloud_conversations" USING btree \("updated_at"\)/);
  assert.match(migration0012, /"idx_whatsapp_cloud_sends_created" ON "whatsapp_cloud_sends" USING btree \("created_at"\)/);
  assert.match(migration0012, /CREATE TABLE "whatsapp_cloud_conversations"/);
  assert.match(migration0012, /PRIMARY KEY\("instance_id","wa_id"\)/);
  assert.match(migration0012, /CREATE TABLE "whatsapp_cloud_sends"/);
  assert.equal((migration0012.match(/ON DELETE cascade/g) ?? []).length, 3);
  assert.match(journal, /"tag": "0012_whatsapp_cloud"/);
});

test("0013 adds coexistence: no PIN for a number kept in the app, and timed owner holds", () => {
  const migration0013 = readFileSync(new URL("../drizzle/0013_whatsapp_cloud_coexistence.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(migration0013, /ALTER TABLE "whatsapp_cloud_numbers" ALTER COLUMN "pin_encrypted" DROP NOT NULL/);
  assert.match(migration0013, /"whatsapp_cloud_conversations" ADD COLUMN "held_until" timestamp with time zone;/);
  assert.match(migration0013, /"whatsapp_cloud_conversations" ADD COLUMN "mode_changed_at" timestamp with time zone;/);
  assert.match(migration0013, /"whatsapp_cloud_numbers" ADD COLUMN "contacts_synced_at" timestamp with time zone;/);
  assert.match(migration0013, /"whatsapp_cloud_numbers" ADD COLUMN "history_synced_at" timestamp with time zone;/);
});

test("hosts migration seeds the table from existing rows before adding the FK", () => {
  const create = migration0017.indexOf('CREATE TABLE "hosts"');
  const seed = migration0017.indexOf('INSERT INTO "hosts" ("id") SELECT DISTINCT "host_id" FROM "instances"');
  const fk = migration0017.indexOf('ADD CONSTRAINT "instances_host_id_hosts_id_fk"');
  assert.ok(create >= 0);
  assert.ok(seed > create);
  assert.ok(fk > seed);
  assert.match(migration0017, /REFERENCES "public"\."hosts"\("id"\) ON DELETE restrict/);
  assert.match(journal, /"tag": "0017_hosts"/);
});

test("host registration migration adds the nullable address and timestamp", () => {
  assert.match(migration0018, /ALTER TABLE "hosts" ADD COLUMN "address" text;/);
  assert.match(migration0018, /ALTER TABLE "hosts" ADD COLUMN "last_registered_at" timestamp with time zone;/);
  assert.doesNotMatch(migration0018, /NOT NULL/);
  assert.match(journal, /"tag": "0018_host_registration"/);
});

test("host capacity migration adds a nullable memory column and a status defaulting to active", () => {
  assert.match(migration0019, /ALTER TABLE "hosts" ADD COLUMN "memory_mb" integer;/);
  assert.match(migration0019, /ALTER TABLE "hosts" ADD COLUMN "status" varchar\(16\) DEFAULT 'active' NOT NULL;/);
  assert.equal((migration0019.match(/ALTER TABLE/g) ?? []).length, 2);
  assert.match(journal, /"tag": "0019_host_capacity"/);
});

test("instance move migration adds four nullable columns and the previous-host FK", () => {
  assert.match(migration0020, /ALTER TABLE "instances" ADD COLUMN "moved_from_host_id" text;/);
  assert.match(migration0020, /ALTER TABLE "instances" ADD COLUMN "move_object_name" text;/);
  assert.match(migration0020, /ALTER TABLE "instances" ADD COLUMN "moved_at" timestamp with time zone;/);
  assert.match(migration0020, /ALTER TABLE "instances" ADD COLUMN "move_imported_at" timestamp with time zone;/);
  assert.match(migration0020, /"instances_moved_from_host_id_hosts_id_fk" FOREIGN KEY \("moved_from_host_id"\) REFERENCES "public"\."hosts"\("id"\)/);
  assert.doesNotMatch(migration0020, /NOT NULL/);
  assert.match(journal, /"tag": "0020_instance_move"/);
});

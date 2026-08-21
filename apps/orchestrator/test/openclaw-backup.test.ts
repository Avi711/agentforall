import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenclawBackupCommand,
  shouldExportOpenclawTopLevelEntry,
} from "../src/services/agent-runtime/openclaw/backup.js";

test("backup export includes durable OpenClaw state directories", () => {
  for (const name of [
    "agents",
    "cron",
    "delivery-queue",
    "devices",
    "flows",
    "identity",
    "media",
    "memory",
    "openclaw.json",
    "openclaw.json.bak",
    "plugin-skills",
    "plugins",
    "tasks",
    "whatsapp-session",
    "workspace",
  ]) {
    assert.equal(shouldExportOpenclawTopLevelEntry(name), true, name);
  }
});

test("backup export excludes runtime-only and volatile entries", () => {
  for (const name of [".env", "logs", "npm"]) {
    assert.equal(shouldExportOpenclawTopLevelEntry(name), false, name);
  }
});

test("backup command exports top-level state by exclusion", () => {
  const command = buildOpenclawBackupCommand();

  assert.match(command, /find \. -mindepth 1 -maxdepth 1/);
  assert.match(command, /! -name \.env/);
  assert.match(command, /! -name logs/);
  assert.match(command, /! -name npm/);
  assert.doesNotMatch(command, /cron/);
});

test("backup command can write to a temp file with failure cleanup", () => {
  const command = buildOpenclawBackupCommand({ outputPath: "$tmp" });

  assert.match(command, /tar -czf "\$tmp" -T -/);
});

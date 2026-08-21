import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
} from "../src/services/agent-runtime/openclaw/config.js";
import { parsePairingListOutput } from "../src/services/agent-runtime/openclaw/whatsapp.js";
import { normalizeE164 } from "../src/domain/phone.js";
import { applyChannelDefaults } from "../src/domain/channels.js";
import { WhatsappAccessManager } from "../src/services/whatsapp-access-manager.js";
import type { EventRepository } from "../src/storage/event-repository.js";
import type { ChannelConfig } from "../src/domain/types.js";
import { configWith, fakeChannelManager, makeInstance } from "./helpers/fixtures.js";

interface GeneratedConfig {
  session: { dmScope: string; identityLinks?: Record<string, string[]> };
  channels: {
    whatsapp?: { dmPolicy: string; allowFrom?: string[]; accounts: unknown };
    telegram?: { allowFrom?: string[] };
  };
}

function generate(channels: ChannelConfig[]): GeneratedConfig {
  const files = generateOpenclawFiles(configWith(channels), "token");
  return JSON.parse(files.configJson) as GeneratedConfig;
}

test("legacy whatsapp channel stays open and gets per-peer scope without links", () => {
  const cfg = generate([{ type: "whatsapp" }]);
  assert.equal(cfg.channels.whatsapp?.dmPolicy, "open");
  assert.deepEqual(cfg.channels.whatsapp?.allowFrom, ["*"]);
  assert.deepEqual(cfg.session, { dmScope: "per-peer" });
});

test("owner-only without a number enters pairing (claim) mode", () => {
  const cfg = generate([{ type: "whatsapp", dmAccess: "owner" }]);
  assert.equal(cfg.channels.whatsapp?.dmPolicy, "pairing");
  assert.equal(cfg.channels.whatsapp?.allowFrom, undefined);
  assert.deepEqual(cfg.session, { dmScope: "per-peer" });
});

test("owner-only with a number allowlists it and links identities across channels", () => {
  const cfg = generate([
    { type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" },
    { type: "telegram", botToken: "t", dmPolicy: "allowlist", allowFrom: ["tg:123456"] },
  ]);
  assert.equal(cfg.channels.whatsapp?.dmPolicy, "allowlist");
  assert.deepEqual(cfg.channels.whatsapp?.allowFrom, ["+972501234567"]);
  assert.deepEqual(cfg.session, {
    dmScope: "per-peer",
    identityLinks: { owner: ["telegram:123456", "whatsapp:+972501234567"] },
  });
});

test("open access with a known owner keeps the wildcard but still links the owner", () => {
  const cfg = generate([{ type: "whatsapp", dmAccess: "open", ownerNumber: "+972501234567" }]);
  assert.equal(cfg.channels.whatsapp?.dmPolicy, "open");
  assert.deepEqual(cfg.channels.whatsapp?.allowFrom, ["*"]);
  assert.deepEqual(cfg.session.identityLinks, { owner: ["whatsapp:+972501234567"] });
});

test("telegram-only bot links its owner so the key survives adding whatsapp later", () => {
  const cfg = generate([
    { type: "telegram", botToken: "t", dmPolicy: "allowlist", allowFrom: ["tg:42"] },
  ]);
  assert.deepEqual(cfg.session, {
    dmScope: "per-peer",
    identityLinks: { owner: ["telegram:42"] },
  });
});

test("runtime patch keeps runtime whatsapp keys but orchestrator owns access policy and session", () => {
  const existing = {
    channels: {
      whatsapp: {
        enabled: true,
        dmPolicy: "open",
        allowFrom: ["*"],
        runtimeOnlyKey: "keep-me",
      },
    },
    session: { dmScope: "main" },
  };
  const files = generateRuntimePatchedOpenclawFiles(
    JSON.stringify(existing),
    configWith([{ type: "whatsapp", dmAccess: "owner" }]),
    "token",
  );
  const patched = JSON.parse(files.configJson) as {
    session: unknown;
    channels: { whatsapp: Record<string, unknown> };
  };
  assert.deepEqual(patched.session, { dmScope: "per-peer" });
  assert.equal(patched.channels.whatsapp.dmPolicy, "pairing");
  assert.equal(patched.channels.whatsapp.allowFrom, undefined);
  assert.equal(patched.channels.whatsapp.runtimeOnlyKey, "keep-me");
});

test("parsePairingListOutput normalizes ids and drops non-phone entries", () => {
  const out = JSON.stringify({
    channel: "whatsapp",
    requests: [
      { id: "+972501234567", code: "ABCD2345", createdAt: "2026-08-21T10:00:00.000Z", meta: { name: "Avi" } },
      { id: "972509999999@s.whatsapp.net", code: "WXYZ6789", createdAt: "2026-08-21T10:01:00.000Z" },
      { id: "not-a-number", code: "QQQQ1111", createdAt: "2026-08-21T10:02:00.000Z" },
    ],
  });
  assert.deepEqual(parsePairingListOutput(out), [
    { number: "+972501234567", code: "ABCD2345", name: "Avi", requestedAt: "2026-08-21T10:00:00.000Z" },
    { number: "+972509999999", code: "WXYZ6789", name: null, requestedAt: "2026-08-21T10:01:00.000Z" },
  ]);
});

test("normalizeE164 accepts common shapes and rejects junk", () => {
  assert.equal(normalizeE164("+972 50-123 4567"), "+972501234567");
  assert.equal(normalizeE164("972501234567"), "+972501234567");
  assert.equal(normalizeE164("whatsapp:+972501234567"), "+972501234567");
  assert.equal(normalizeE164("0501234567"), null);
  assert.equal(normalizeE164("+1"), null);
  assert.equal(normalizeE164("abc"), null);
});

test("applyChannelDefaults makes new whatsapp channels owner-only and leaves others alone", () => {
  assert.deepEqual(
    applyChannelDefaults([{ type: "whatsapp" }, { type: "telegram" }]),
    [{ type: "whatsapp", dmAccess: "owner" }, { type: "telegram" }],
  );
  assert.deepEqual(
    applyChannelDefaults([{ type: "whatsapp", dmAccess: "open" }]),
    [{ type: "whatsapp", dmAccess: "open" }],
  );
});

test("WhatsappAccessManager switches access without touching the owner number", async () => {
  const inst = makeInstance([{ type: "whatsapp", dmAccess: "owner", ownerNumber: "+972501234567" }]);
  const channels = fakeChannelManager(inst);
  const events: string[] = [];
  const eventLog = {
    append: async (_id: string, type: string) => {
      events.push(type);
    },
  } as unknown as EventRepository;
  const access = new WhatsappAccessManager(channels.manager, eventLog);

  const before = await access.get(inst.id, inst.userId);
  assert.equal(before.access, "owner");
  assert.equal(before.claiming, false);
  assert.equal(before.configured, true);
  assert.equal(before.botNumber, "+972555555555");
  assert.equal(before.ownerNumber, "+972501234567");

  const opened = await access.update(inst.id, inst.userId, { access: "open" });
  assert.equal(opened.access, "open");
  assert.equal(opened.ownerNumber, "+972501234567");
  assert.deepEqual(channels.writes[0], [
    { type: "whatsapp", dmAccess: "open", ownerNumber: "+972501234567" },
  ]);
  assert.deepEqual(events, ["whatsapp.access_updated"]);

  // Same access again: no config write, no restart, no event.
  const same = await access.update(inst.id, inst.userId, { access: "open" });
  assert.equal(same.access, "open");
  assert.equal(channels.writes.length, 1);
  assert.equal(events.length, 1);

  channels.reset(makeInstance([{ type: "whatsapp" }]));
  const legacy = await access.get(inst.id, inst.userId);
  assert.equal(legacy.access, "open");
  assert.equal(legacy.configured, false);

  const locked = await access.update(inst.id, inst.userId, { access: "owner" });
  assert.equal(locked.claiming, true);
  assert.equal(locked.configured, true);

  channels.reset(makeInstance([{ type: "telegram" }]));
  await assert.rejects(() => access.update(inst.id, inst.userId, { access: "open" }), /not found/);
});

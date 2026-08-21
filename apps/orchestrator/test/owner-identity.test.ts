import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import {
  generateOpenclawFiles,
  generateRuntimePatchedOpenclawFiles,
  readOwnerAllowFrom,
} from "../src/services/agent-runtime/openclaw/config.js";
import { ownerIdentityOf, ownerPeerIds, sameOwnerIds } from "../src/domain/owner.js";
import { NotFoundError } from "../src/domain/errors.js";
import { OwnerIdentityManager } from "../src/services/owner-identity-manager.js";
import type { AgentRuntimeRegistry } from "../src/services/agent-runtime/registry.js";
import type { WhatsappPairingRequest } from "../src/services/agent-runtime/types.js";
import type { EventRepository } from "../src/storage/event-repository.js";
import type { ChannelConfig, Instance } from "../src/domain/types.js";
import { configWith, fakeChannelManager, makeInstance } from "./helpers/fixtures.js";

const TELEGRAM: ChannelConfig = {
  type: "telegram",
  botToken: "t",
  dmPolicy: "allowlist",
  allowFrom: ["tg:123456"],
};
const WHATSAPP_OWNED: ChannelConfig = {
  type: "whatsapp",
  dmAccess: "open",
  ownerNumber: "+972501234567",
};
const OWNER_IDS = ["telegram:123456", "whatsapp:+972501234567"];

interface GeneratedConfig {
  session: { dmScope: string; identityLinks?: Record<string, string[]> };
  commands?: { ownerAllowFrom: string[] };
}

function generate(channels: ChannelConfig[]): GeneratedConfig {
  const files = generateOpenclawFiles(configWith(channels), "token");
  return JSON.parse(files.configJson) as GeneratedConfig;
}

function patch(existing: unknown, channels: ChannelConfig[]): GeneratedConfig {
  const files = generateRuntimePatchedOpenclawFiles(
    JSON.stringify(existing),
    configWith(channels),
    "token",
  );
  return JSON.parse(files.configJson) as GeneratedConfig;
}

test("ownerIdentityOf reads telegram from the allowlist and whatsapp from ownerNumber", () => {
  assert.deepEqual(ownerIdentityOf([TELEGRAM, WHATSAPP_OWNED]), {
    telegramUserId: "123456",
    whatsappNumber: "+972501234567",
  });
  assert.deepEqual(ownerIdentityOf([{ type: "whatsapp" }]), {
    telegramUserId: null,
    whatsappNumber: null,
  });
  assert.deepEqual(ownerIdentityOf([{ type: "telegram" }]), {
    telegramUserId: null,
    whatsappNumber: null,
  });
});

test("ownerPeerIds emits channel-prefixed ids and sameOwnerIds ignores order", () => {
  const ids = ownerPeerIds({ telegramUserId: "123456", whatsappNumber: "+972501234567" });
  assert.deepEqual(ids, OWNER_IDS);
  assert.equal(sameOwnerIds(ids, [...ids].reverse()), true);
  assert.equal(sameOwnerIds(ids, ["telegram:123456"]), false);
  assert.equal(sameOwnerIds([], []), true);
});

test("identityLinks and commands.ownerAllowFrom come from the same owner ids", () => {
  const cfg = generate([TELEGRAM, WHATSAPP_OWNED]);
  assert.deepEqual(cfg.session, { dmScope: "per-peer", identityLinks: { owner: OWNER_IDS } });
  assert.deepEqual(cfg.commands, { ownerAllowFrom: OWNER_IDS });
});

test("no owner means no commands block and no identity links", () => {
  const cfg = generate([{ type: "whatsapp", dmAccess: "owner" }]);
  assert.deepEqual(cfg.session, { dmScope: "per-peer" });
  assert.equal(cfg.commands, undefined);
});

test("runtime patch: orchestrator owns the commands block", () => {
  const existing = {
    commands: { ownerAllowFrom: ["whatsapp:+972509999999"] },
    session: { dmScope: "main" },
  };
  assert.deepEqual(patch(existing, [TELEGRAM]).commands, { ownerAllowFrom: ["telegram:123456"] });
  assert.equal(patch(existing, [{ type: "whatsapp" }]).commands, undefined);
});

test("readOwnerAllowFrom tolerates missing or malformed blocks", () => {
  assert.deepEqual(readOwnerAllowFrom("{}"), []);
  assert.deepEqual(readOwnerAllowFrom(JSON.stringify({ commands: null })), []);
  assert.deepEqual(readOwnerAllowFrom(JSON.stringify({ commands: { ownerAllowFrom: "x" } })), []);
  assert.deepEqual(
    readOwnerAllowFrom(JSON.stringify({ commands: { ownerAllowFrom: ["telegram:1", 2, null] } })),
    ["telegram:1"],
  );
});

interface FakeAdapter {
  readOwnerIds?: () => Promise<string[] | null>;
  listWhatsappPairingRequests?: () => Promise<WhatsappPairingRequest[]>;
}

function harness(initial: Instance, adapter: FakeAdapter) {
  const channels = fakeChannelManager(initial);
  const events: string[] = [];
  const runtimes = {
    get: () => ({
      readOwnerIds: async () => [],
      listWhatsappPairingRequests: async () => [],
      ...adapter,
    }),
  } as unknown as AgentRuntimeRegistry;
  const eventLog = {
    append: async (_id: string, type: string) => {
      events.push(type);
    },
  } as unknown as EventRepository;
  const logger = { warn: () => {} } as unknown as FastifyBaseLogger;
  return {
    owner: new OwnerIdentityManager(channels.manager, runtimes, eventLog, logger),
    writes: channels.writes,
    events,
  };
}

test("sync state compares desired owner ids with the live config", async () => {
  const inst = makeInstance([TELEGRAM, WHATSAPP_OWNED]);

  const applied = harness(inst, { readOwnerIds: async () => [...OWNER_IDS].reverse() });
  assert.equal((await applied.owner.get(inst.id, inst.userId)).sync, "applied");

  const pending = harness(inst, { readOwnerIds: async () => ["telegram:123456"] });
  assert.equal((await pending.owner.get(inst.id, inst.userId)).sync, "pending");

  const unsupported = harness(inst, { readOwnerIds: async () => null });
  assert.equal((await unsupported.owner.get(inst.id, inst.userId)).sync, "unavailable");

  const failing = harness(inst, {
    readOwnerIds: async () => {
      throw new Error("exec failed");
    },
  });
  assert.equal((await failing.owner.get(inst.id, inst.userId)).sync, "unavailable");

  const stopped = makeInstance([TELEGRAM, WHATSAPP_OWNED], { status: "stopped" });
  assert.equal((await harness(stopped, {}).owner.get(stopped.id, stopped.userId)).sync, "unavailable");
});

test("view exposes the telegram identity with the bot username", async () => {
  const inst = makeInstance([
    { ...TELEGRAM, botUsername: "my_bot" },
    { type: "whatsapp", dmAccess: "owner" },
  ]);
  const view = await harness(inst, {}).owner.get(inst.id, inst.userId);
  assert.deepEqual(view.telegram, { userId: "123456", botUsername: "my_bot" });
  assert.equal(view.whatsappNumber, null);
});

test("update normalizes, stores, and clears the whatsapp number without touching access", async () => {
  const inst = makeInstance([{ type: "whatsapp", dmAccess: "open" }]);
  const h = harness(inst, { readOwnerIds: async () => ["whatsapp:+972501234567"] });

  const set = await h.owner.update(inst.id, inst.userId, { whatsappNumber: "972501234567" });
  assert.equal(set.whatsappNumber, "+972501234567");
  assert.equal(set.sync, "applied");
  assert.deepEqual(h.writes[0], [
    { type: "whatsapp", dmAccess: "open", ownerNumber: "+972501234567" },
  ]);
  assert.deepEqual(h.events, ["owner.identity_updated"]);

  // Same number again: no config write, no restart, no event.
  const same = await h.owner.update(inst.id, inst.userId, { whatsappNumber: "+972 50-123-4567" });
  assert.equal(same.whatsappNumber, "+972501234567");
  assert.equal(h.writes.length, 1);
  assert.equal(h.events.length, 1);

  const cleared = await h.owner.update(inst.id, inst.userId, { whatsappNumber: null });
  assert.equal(cleared.whatsappNumber, null);
  assert.deepEqual(h.writes[1], [{ type: "whatsapp", dmAccess: "open" }]);

  await assert.rejects(
    () => h.owner.update(inst.id, inst.userId, { whatsappNumber: "garbage" }),
    /E\.164/,
  );
  assert.equal(h.writes.length, 2);
});

test("update refuses when the bot has no whatsapp channel", async () => {
  const inst = makeInstance([TELEGRAM]);
  await assert.rejects(
    () => harness(inst, {}).owner.update(inst.id, inst.userId, { whatsappNumber: "+972501234567" }),
    NotFoundError,
  );
});

test("candidates surface only in claim mode", async () => {
  const pending: WhatsappPairingRequest[] = [
    { number: "+972501234567", code: "ABCD2345", name: "Avi", requestedAt: "2026-08-21T10:00:00.000Z" },
  ];

  const claiming = makeInstance([{ type: "whatsapp", dmAccess: "owner" }]);
  const h1 = harness(claiming, { listWhatsappPairingRequests: async () => pending });
  assert.deepEqual((await h1.owner.get(claiming.id, claiming.userId)).candidates, pending);

  const open = makeInstance([{ type: "whatsapp", dmAccess: "open" }]);
  let listed = false;
  const h2 = harness(open, {
    listWhatsappPairingRequests: async () => {
      listed = true;
      return pending;
    },
  });
  assert.deepEqual((await h2.owner.get(open.id, open.userId)).candidates, []);
  assert.equal(listed, false);

  const failing = harness(claiming, {
    listWhatsappPairingRequests: async () => {
      throw new Error("exec failed");
    },
  });
  const view = await failing.owner.get(claiming.id, claiming.userId);
  assert.deepEqual(view.candidates, []);
  assert.equal(view.candidatesUnavailable, true);
});

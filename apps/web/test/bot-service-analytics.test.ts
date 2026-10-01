import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProductEvent } from "../src/lib/analytics/events";
import type { BotLifecycleHooks } from "../src/lib/billing";
import type { BillingUser } from "../src/lib/billing/domain";
import type { BotOrchestratorPort } from "../src/lib/bots/service";
import type { Instance } from "../src/lib/orchestrator/types";

const OWNER: BillingUser = { id: "user-1", email: "u@example.com", name: "Dana", betaAccess: false };

const BOT: Instance = {
  id: "8a6a5f5e-3f0e-4b8a-9d0c-2a4f1c9e7b11",
  userId: OWNER.id,
  displayName: "Assistant",
  runtimeKind: "openclaw",
  status: "running",
  containerName: "bot-1",
  containerId: null,
  gatewayPort: 18789,
  healthFailures: 0,
  errorMessage: null,
  pairingStatus: "none",
  whatsappAccountId: null,
  hasWhatsappCreds: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  config: { displayName: "Assistant", provider: { name: "openai", model: "gpt" }, channels: [] },
};

function notUsed(method: string) {
  return () => Promise.reject(new Error(`${method} is not used by this test`));
}

function fakeOrchestrator(overrides: Partial<BotOrchestratorPort>): BotOrchestratorPort {
  return {
    listBots: notUsed("listBots"),
    createBot: notUsed("createBot"),
    getBot: notUsed("getBot"),
    deleteBot: notUsed("deleteBot"),
    restartBot: notUsed("restartBot"),
    startBotBackupExport: notUsed("startBotBackupExport"),
    getBotBackupExport: notUsed("getBotBackupExport"),
    createBackupUploadSession: notUsed("createBackupUploadSession"),
    restoreBackupUpload: notUsed("restoreBackupUpload"),
    startPairing: notUsed("startPairing"),
    cancelPairing: notUsed("cancelPairing"),
    getPairQr: notUsed("getPairQr"),
    requestPairCode: notUsed("requestPairCode"),
    getPairStatus: notUsed("getPairStatus"),
    startTelegramLink: notUsed("startTelegramLink"),
    getTelegramLinkStatus: notUsed("getTelegramLinkStatus"),
    getWhatsappAccess: notUsed("getWhatsappAccess"),
    updateWhatsappAccess: notUsed("updateWhatsappAccess"),
    getOwnerIdentity: notUsed("getOwnerIdentity"),
    updateOwnerIdentity: notUsed("updateOwnerIdentity"),
    disconnectWhatsapp: notUsed("disconnectWhatsapp"),
    disconnectTelegram: notUsed("disconnectTelegram"),
    ...overrides,
  };
}

const HOOKS: BotLifecycleHooks = {
  beforeBotCreate: async () => {},
  afterBotCreated: async () => {},
  beforeBotDelete: async () => {},
};

async function setup(existing: Instance[]) {
  // The module builds its default singleton on import, which reads the orchestrator settings.
  process.env.ORCHESTRATOR_BASE_URL = "http://orchestrator.test";
  process.env.ORCHESTRATOR_SERVICE_TOKEN = "test-service-token";
  const { BotService } = await import("../src/lib/bots/service");
  const tracked: Array<{ userId: string; event: ProductEvent }> = [];
  const orchestrator = fakeOrchestrator({
    listBots: async () => existing,
    createBot: async () => BOT,
    restoreBackupUpload: async () => BOT,
  });
  const service = new BotService(orchestrator, HOOKS, (userId, event) => {
    tracked.push({ userId, event });
  });
  return { service, tracked };
}

test("a newly created bot is tracked; returning the owner's existing bot is not", async () => {
  const fresh = await setup([]);
  await fresh.service.createBot(OWNER, { displayName: "Assistant", channel: "whatsapp" });
  assert.deepEqual(fresh.tracked, [{ userId: OWNER.id, event: { name: "bot_created", source: "new" } }]);

  const reused = await setup([BOT]);
  await reused.service.createBot(OWNER, { displayName: "Assistant", channel: "whatsapp" });
  assert.deepEqual(reused.tracked, []);
});

test("a bot restored from a backup is tracked as created from a backup", async () => {
  const { service, tracked } = await setup([]);
  await service.restoreBackupUpload(OWNER, "restore-token");
  assert.deepEqual(tracked, [{ userId: OWNER.id, event: { name: "bot_created", source: "backup" } }]);
});

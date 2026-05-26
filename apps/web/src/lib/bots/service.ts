import "server-only";
import {
  getOrchestratorClient,
  type BackupExportJob,
  type BackupUploadSession,
} from "../orchestrator/client";
import type {
  Instance,
  BotUsage,
  PairCode,
  PairQr,
  PairStatus,
  StartPairingResult,
} from "../orchestrator/types";
import type { CreateBotBody, PhoneBody } from "./schemas";

export interface CreateBotResult {
  bot: Instance;
  created: boolean;
}

export interface BotOrchestratorPort {
  listBots(userId: string): Promise<Instance[]>;
  createBot(
    userId: string,
    input: { displayName: string },
  ): Promise<Instance>;
  getBot(userId: string, id: string): Promise<Instance>;
  getBotUsage(userId: string, id: string): Promise<BotUsage>;
  deleteBot(userId: string, id: string): Promise<void>;
  restartBot(userId: string, id: string): Promise<void>;
  startBotBackupExport(userId: string, id: string): Promise<BackupExportJob>;
  getBotBackupExport(
    userId: string,
    id: string,
    jobId: string,
  ): Promise<BackupExportJob>;
  createBackupUploadSession(
    userId: string,
    input: {
      displayName: string;
      contentLength: number;
      contentType?: string;
    },
  ): Promise<BackupUploadSession>;
  restoreBackupUpload(userId: string, restoreToken: string): Promise<Instance>;
  startPairing(userId: string, id: string): Promise<StartPairingResult>;
  cancelPairing(userId: string, id: string): Promise<void>;
  getPairQr(userId: string, id: string): Promise<PairQr>;
  requestPairCode(userId: string, id: string, phone: string): Promise<PairCode>;
  getPairStatus(userId: string, id: string): Promise<PairStatus>;
}

export class BotService {
  constructor(
    private readonly orchestrator: BotOrchestratorPort = getOrchestratorClient(),
  ) {}

  findActiveBot(userId: string): Promise<Instance | null> {
    return this.listBots(userId).then(
      (bots) => bots.find((bot) => isActiveBot(bot)) ?? null,
    );
  }

  listBots(userId: string): Promise<Instance[]> {
    return this.orchestrator.listBots(userId);
  }

  async createBot(userId: string, input: CreateBotBody): Promise<CreateBotResult> {
    const active = await this.findActiveBot(userId);
    if (active) return { bot: active, created: false };
    const bot = await this.orchestrator.createBot(userId, {
      displayName: input.displayName,
    });
    return { bot, created: true };
  }

  getBot(userId: string, id: string): Promise<Instance> {
    return this.orchestrator.getBot(userId, id);
  }

  getBotUsage(userId: string, id: string): Promise<BotUsage> {
    return this.orchestrator.getBotUsage(userId, id);
  }

  deleteBot(userId: string, id: string): Promise<void> {
    return this.orchestrator.deleteBot(userId, id);
  }

  restartBot(userId: string, id: string): Promise<void> {
    return this.orchestrator.restartBot(userId, id);
  }

  startBackupExport(userId: string, id: string): Promise<BackupExportJob> {
    return this.orchestrator.startBotBackupExport(userId, id);
  }

  getBackupExport(
    userId: string,
    id: string,
    jobId: string,
  ): Promise<BackupExportJob> {
    return this.orchestrator.getBotBackupExport(userId, id, jobId);
  }

  createBackupUploadSession(
    userId: string,
    input: {
      displayName: string;
      contentLength: number;
      contentType?: string;
    },
  ): Promise<BackupUploadSession> {
    return this.orchestrator.createBackupUploadSession(userId, {
      displayName: input.displayName,
      contentLength: input.contentLength,
      contentType: input.contentType,
    });
  }

  restoreBackupUpload(userId: string, restoreToken: string): Promise<Instance> {
    return this.orchestrator.restoreBackupUpload(userId, restoreToken);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    const bots = await this.orchestrator.listBots(userId);
    for (const bot of bots) {
      if (bot.status === "destroyed") continue;
      await this.orchestrator.deleteBot(userId, bot.id);
    }
  }

  startPairing(userId: string, id: string): Promise<StartPairingResult> {
    return this.orchestrator.startPairing(userId, id);
  }

  cancelPairing(userId: string, id: string): Promise<void> {
    return this.orchestrator.cancelPairing(userId, id);
  }

  getPairQr(userId: string, id: string): Promise<PairQr> {
    return this.orchestrator.getPairQr(userId, id);
  }

  requestPairCode(
    userId: string,
    id: string,
    input: PhoneBody,
  ): Promise<PairCode> {
    return this.orchestrator.requestPairCode(userId, id, input.phone);
  }

  getPairStatus(userId: string, id: string): Promise<PairStatus> {
    return this.orchestrator.getPairStatus(userId, id);
  }
}

export const botService = new BotService();

function isActiveBot(bot: Instance): boolean {
  return bot.status !== "destroyed" && bot.status !== "error";
}

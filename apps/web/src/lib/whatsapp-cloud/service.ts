import "server-only";
import type { WhatsappCloudView } from "../orchestrator/types";
import { getOrchestratorClient } from "../orchestrator/client";
import { isWhatsappCloudEnabledFor, readWhatsappCloudConfig } from "./config";
import { MetaGraphOAuth, type MetaOAuthClient } from "./meta-oauth";
import type { WhatsappCloudConnectBody } from "./schemas";

export interface WhatsappCloudConnectInput {
  accessToken: string;
  phoneNumberId?: string;
  wabaId: string;
  businessId?: string;
  pin?: string;
  coexistence?: boolean;
}

export interface WhatsappCloudPort {
  connectWhatsappCloud(userId: string, botId: string, input: WhatsappCloudConnectInput): Promise<WhatsappCloudView>;
  getWhatsappCloudStatus(userId: string, botId: string): Promise<WhatsappCloudView>;
  disconnectWhatsappCloud(userId: string, botId: string): Promise<void>;
}

export class WhatsappCloudUnavailableError extends Error {
  constructor() {
    super("WhatsApp Business is not configured");
    this.name = "WhatsappCloudUnavailableError";
  }
}

// The Meta app identity lives here; per-tenant tokens are handed straight to the orchestrator.
export class WhatsappCloudService {
  constructor(
    private readonly port: WhatsappCloudPort,
    private readonly oauth: MetaOAuthClient | null,
    private readonly isEnabledFor: (userId: string) => boolean,
  ) {}

  async connect(userId: string, botId: string, body: WhatsappCloudConnectBody): Promise<WhatsappCloudView> {
    if (!this.oauth || !this.isEnabledFor(userId)) throw new WhatsappCloudUnavailableError();
    const accessToken = await this.oauth.exchangeCode(body.code);
    return this.port.connectWhatsappCloud(userId, botId, {
      accessToken,
      wabaId: body.wabaId,
      ...(body.phoneNumberId ? { phoneNumberId: body.phoneNumberId } : {}),
      ...(body.businessId ? { businessId: body.businessId } : {}),
      ...(body.pin ? { pin: body.pin } : {}),
      ...(body.coexistence ? { coexistence: true } : {}),
    });
  }

  status(userId: string, botId: string): Promise<WhatsappCloudView> {
    return this.port.getWhatsappCloudStatus(userId, botId);
  }

  disconnect(userId: string, botId: string): Promise<void> {
    return this.port.disconnectWhatsappCloud(userId, botId);
  }
}

let cached: WhatsappCloudService | undefined;

export function getWhatsappCloudService(): WhatsappCloudService {
  if (!cached) {
    const config = readWhatsappCloudConfig();
    cached = new WhatsappCloudService(
      getOrchestratorClient(),
      config ? new MetaGraphOAuth(config.appId, config.appSecret, config.graphApiVersion) : null,
      isWhatsappCloudEnabledFor,
    );
  }
  return cached;
}

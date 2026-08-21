import {
  WHATSAPP_DM_ACCESS,
  isProvisioningStage,
  type Instance,
  type ProvisioningStage,
  type WhatsappDmAccess,
} from "../orchestrator/types";

export interface TelegramSnapshot {
  linked: boolean;
  botUsername: string | null;
}

export interface WhatsappAccessSnapshot {
  access: WhatsappDmAccess;
  configured: boolean;
}

export interface OwnerSnapshot {
  telegramLinked: boolean;
  whatsappNumber: string | null;
}

export interface BotSnapshot {
  id: string;
  displayName: string;
  status: string;
  provisioningStage: ProvisioningStage | null;
  pairingStatus: string;
  whatsappAccountId: string | null;
  hasWhatsappCreds: boolean;
  hasWhatsappChannel: boolean;
  whatsappAccess: WhatsappAccessSnapshot | null;
  owner: OwnerSnapshot;
  telegram: TelegramSnapshot | null;
  lastSeenAt: string | null;
}

type Channels = Instance["config"]["channels"];

export function toBotSnapshot(bot: Instance): BotSnapshot {
  return {
    id: bot.id,
    displayName: bot.displayName,
    status: bot.status,
    provisioningStage: provisioningStageOf(bot),
    pairingStatus: bot.pairingStatus,
    whatsappAccountId: bot.whatsappAccountId,
    hasWhatsappCreds: bot.hasWhatsappCreds,
    hasWhatsappChannel: bot.config.channels.some((ch) => ch.type === "whatsapp"),
    whatsappAccess: whatsappAccessSnapshot(bot.config.channels),
    owner: ownerSnapshot(bot.config.channels),
    telegram: telegramSnapshot(bot.config.channels),
    lastSeenAt: bot.lastSeenAt ?? null,
  };
}

function whatsappAccessSnapshot(channels: Channels): WhatsappAccessSnapshot | null {
  const ch = channels.find((c) => c.type === "whatsapp");
  if (!ch) return null;
  const access = WHATSAPP_DM_ACCESS.find((a) => a === ch.dmAccess);
  return { access: access ?? "open", configured: access !== undefined };
}

// The Telegram allowlist is the owner; the orchestrator writes it as "tg:<id>".
function ownerSnapshot(channels: Channels): OwnerSnapshot {
  const telegram = channels.find((c) => c.type === "telegram");
  const whatsapp = channels.find((c) => c.type === "whatsapp");
  const allowFrom: unknown[] = Array.isArray(telegram?.allowFrom) ? telegram.allowFrom : [];
  return {
    telegramLinked: allowFrom.some(
      (entry) => typeof entry === "string" && /^(?:tg:|telegram:)?\d+$/.test(entry),
    ),
    whatsappNumber: typeof whatsapp?.ownerNumber === "string" ? whatsapp.ownerNumber : null,
  };
}

function telegramSnapshot(channels: Channels): TelegramSnapshot | null {
  const ch = channels.find((c) => c.type === "telegram");
  if (!ch) return null;
  return {
    linked: typeof ch.botToken === "string",
    botUsername: typeof ch.botUsername === "string" ? ch.botUsername : null,
  };
}

// Older orchestrators omit the stage; the container id still tells us the environment exists.
function provisioningStageOf(bot: Instance): ProvisioningStage | null {
  if (isProvisioningStage(bot.provisioningStage)) return bot.provisioningStage;
  if (bot.status !== "provisioning") return null;
  return bot.containerId ? "container_created" : "reserved";
}

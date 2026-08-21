import { WHATSAPP_DM_ACCESS, type Instance, type WhatsappDmAccess } from "../orchestrator/types";

export interface TelegramSnapshot {
  linked: boolean;
  botUsername: string | null;
}

export interface WhatsappAccessSnapshot {
  ownerNumber: string | null;
  access: WhatsappDmAccess;
  configured: boolean;
}

export interface BotSnapshot {
  id: string;
  displayName: string;
  status: string;
  pairingStatus: string;
  whatsappAccountId: string | null;
  hasWhatsappCreds: boolean;
  hasWhatsappChannel: boolean;
  whatsappAccess: WhatsappAccessSnapshot | null;
  telegram: TelegramSnapshot | null;
  lastSeenAt: string | null;
}

export function toBotSnapshot(bot: Instance): BotSnapshot {
  return {
    id: bot.id,
    displayName: bot.displayName,
    status: bot.status,
    pairingStatus: bot.pairingStatus,
    whatsappAccountId: bot.whatsappAccountId,
    hasWhatsappCreds: bot.hasWhatsappCreds,
    hasWhatsappChannel: bot.config.channels.some((ch) => ch.type === "whatsapp"),
    whatsappAccess: whatsappAccessSnapshot(bot.config.channels),
    telegram: telegramSnapshot(bot.config.channels),
    lastSeenAt: bot.lastSeenAt ?? null,
  };
}

function whatsappAccessSnapshot(
  channels: Instance["config"]["channels"],
): WhatsappAccessSnapshot | null {
  const ch = channels.find((c) => c.type === "whatsapp");
  if (!ch) return null;
  const access = WHATSAPP_DM_ACCESS.find((a) => a === ch.dmAccess);
  return {
    ownerNumber: typeof ch.ownerNumber === "string" ? ch.ownerNumber : null,
    access: access ?? "open",
    configured: access !== undefined,
  };
}

function telegramSnapshot(
  channels: Instance["config"]["channels"],
): TelegramSnapshot | null {
  const ch = channels.find((c) => c.type === "telegram");
  if (!ch) return null;
  return {
    linked: typeof ch.botToken === "string",
    botUsername: typeof ch.botUsername === "string" ? ch.botUsername : null,
  };
}

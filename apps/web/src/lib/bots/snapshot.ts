import type { Instance } from "../orchestrator/types";

export interface TelegramSnapshot {
  linked: boolean;
  botUsername: string | null;
}

export interface BotSnapshot {
  id: string;
  displayName: string;
  status: string;
  pairingStatus: string;
  whatsappAccountId: string | null;
  hasWhatsappCreds: boolean;
  hasWhatsappChannel: boolean;
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
    telegram: telegramSnapshot(bot.config.channels),
    lastSeenAt: bot.lastSeenAt ?? null,
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

import type { ChannelConfig, TelegramChannelConfig, WhatsappChannelConfig } from "./types.js";

// New WhatsApp channels start owner-only (claim mode); legacy rows keep dmAccess undefined.
export function applyChannelDefaults(channels: ChannelConfig[]): ChannelConfig[] {
  return channels.map((ch) =>
    ch.type === "whatsapp" && ch.dmAccess === undefined
      ? { ...ch, dmAccess: "owner" }
      : ch,
  );
}

export function findWhatsappChannel(
  channels: ChannelConfig[],
): WhatsappChannelConfig | undefined {
  return channels.find((ch): ch is WhatsappChannelConfig => ch.type === "whatsapp");
}

export function replaceWhatsappChannel(
  channels: ChannelConfig[],
  whatsapp: WhatsappChannelConfig,
): ChannelConfig[] {
  return channels.map((ch) => (ch.type === "whatsapp" ? whatsapp : ch));
}

// Adds the channel when missing; the number is the phone the owner writes from, not the bot's own.
export function withWhatsappOwnerNumber(
  channels: ChannelConfig[],
  ownerNumber: string | null,
): ChannelConfig[] {
  const current = findWhatsappChannel(channels);
  if (!current) {
    return applyChannelDefaults([
      ...channels,
      { type: "whatsapp", ...(ownerNumber ? { ownerNumber } : {}) },
    ]);
  }
  if (!ownerNumber || current.ownerNumber === ownerNumber) return channels;
  return replaceWhatsappChannel(channels, { ...current, dmAccess: "owner", ownerNumber });
}

export function findTelegramChannel(
  channels: ChannelConfig[],
): TelegramChannelConfig | undefined {
  return channels.find((ch): ch is TelegramChannelConfig => ch.type === "telegram");
}

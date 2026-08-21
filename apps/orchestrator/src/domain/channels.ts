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

export function findTelegramChannel(
  channels: ChannelConfig[],
): TelegramChannelConfig | undefined {
  return channels.find((ch): ch is TelegramChannelConfig => ch.type === "telegram");
}

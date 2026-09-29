import { findTelegramChannel, findWhatsappChannel, findWhatsappCloudChannel } from "./channels.js";
import type { ChannelConfig, Instance } from "./types.js";

export interface OwnerRoute {
  channel: "telegram" | "whatsapp";
  to: string;
}

export interface OwnerIdentity {
  telegramUserId: string | null;
  whatsappNumber: string | null;
  // The owner's own phone also identifies them on the business number, when the bot has one.
  hasBusinessNumber: boolean;
}

// The Telegram allowlist is the owner; the linker writes it as "tg:<id>".
export function ownerIdentityOf(channels: ChannelConfig[]): OwnerIdentity {
  const telegram = findTelegramChannel(channels);
  const whatsapp = findWhatsappChannel(channels);
  return {
    telegramUserId: telegram ? telegramOwnerId(telegram.allowFrom ?? []) : null,
    whatsappNumber: whatsapp?.ownerNumber ?? null,
    hasBusinessNumber: findWhatsappCloudChannel(channels) !== undefined,
  };
}

// Channel-prefixed peer ids — the shape OpenClaw uses for both identityLinks and commands.ownerAllowFrom.
export function ownerPeerIds(identity: OwnerIdentity): string[] {
  const ids: string[] = [];
  if (identity.telegramUserId) ids.push(`telegram:${identity.telegramUserId}`);
  if (identity.whatsappNumber) {
    ids.push(`whatsapp:${identity.whatsappNumber}`);
    if (identity.hasBusinessNumber) ids.push(`whatsapp_cloud:${identity.whatsappNumber}`);
  }
  return ids;
}

// The DM the bot itself can write to: its Telegram bot once linked, else its paired WhatsApp number.
export function ownerRouteOf(inst: Pick<Instance, "config" | "pairingStatus">): OwnerRoute | null {
  const identity = ownerIdentityOf(inst.config.channels);
  if (identity.telegramUserId && findTelegramChannel(inst.config.channels)?.botToken) {
    return { channel: "telegram", to: identity.telegramUserId };
  }
  if (identity.whatsappNumber && inst.pairingStatus === "paired") {
    return { channel: "whatsapp", to: identity.whatsappNumber };
  }
  return null;
}

export function sameOwnerIds(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((id) => setB.has(id));
}

function telegramOwnerId(allowFrom: string[]): string | null {
  for (const entry of allowFrom) {
    const match = /^(?:tg:|telegram:)?(\d+)$/.exec(entry.trim());
    if (match?.[1]) return match[1];
  }
  return null;
}

import { findTelegramChannel, findWhatsappChannel } from "./channels.js";
import type { ChannelConfig } from "./types.js";

export interface OwnerIdentity {
  telegramUserId: string | null;
  whatsappNumber: string | null;
}

// The Telegram allowlist is the owner; the linker writes it as "tg:<id>".
export function ownerIdentityOf(channels: ChannelConfig[]): OwnerIdentity {
  const telegram = findTelegramChannel(channels);
  const whatsapp = findWhatsappChannel(channels);
  return {
    telegramUserId: telegram ? telegramOwnerId(telegram.allowFrom ?? []) : null,
    whatsappNumber: whatsapp?.ownerNumber ?? null,
  };
}

// Channel-prefixed peer ids — the shape OpenClaw uses for both identityLinks and commands.ownerAllowFrom.
export function ownerPeerIds(identity: OwnerIdentity): string[] {
  const ids: string[] = [];
  if (identity.telegramUserId) ids.push(`telegram:${identity.telegramUserId}`);
  if (identity.whatsappNumber) ids.push(`whatsapp:${identity.whatsappNumber}`);
  return ids;
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

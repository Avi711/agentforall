import { NotFoundError } from "../domain/errors.js";
import { findWhatsappChannel, replaceWhatsappChannel } from "../domain/channels.js";
import { normalizeE164 } from "../domain/phone.js";
import type {
  Instance,
  WhatsappChannelConfig,
  WhatsappDmAccess,
} from "../domain/types.js";
import type { EventRepository } from "../storage/event-repository.js";
import type { InstanceManager } from "./instance-manager.js";

// Access is who may write to the bot; the owner's identity lives in OwnerIdentityManager.
export interface WhatsappAccessView {
  botNumber: string | null;
  ownerNumber: string | null;
  access: WhatsappDmAccess;
  // false = legacy channel that predates access control (still open).
  configured: boolean;
  // Owner-only without a known owner: senders are held until the owner number is set.
  claiming: boolean;
}

export interface WhatsappAccessUpdate {
  access: WhatsappDmAccess;
}

export class WhatsappAccessManager {
  constructor(
    private readonly manager: InstanceManager,
    private readonly eventLog: EventRepository,
  ) {}

  async get(instanceId: string, userId: string): Promise<WhatsappAccessView> {
    const inst = await this.manager.get(instanceId, userId);
    return toView(inst, requireWhatsappChannel(inst));
  }

  async update(
    instanceId: string,
    userId: string,
    patch: WhatsappAccessUpdate,
  ): Promise<WhatsappAccessView> {
    const { instance, changed } = await this.manager.updateChannels(
      instanceId,
      userId,
      (channels) => {
        const current = findWhatsappChannel(channels);
        if (!current) throw new NotFoundError("whatsapp channel", instanceId);
        // Same access → no config write, no container restart.
        if (current.dmAccess === patch.access) return channels;
        return replaceWhatsappChannel(channels, { ...current, dmAccess: patch.access });
      },
    );
    const channel = requireWhatsappChannel(instance);
    if (changed) {
      await this.eventLog.append(instanceId, "whatsapp.access_updated", {
        actor: userId,
        payload: {
          access: channel.dmAccess,
          claiming: channel.dmAccess === "owner" && !channel.ownerNumber,
        },
      });
    }
    return toView(instance, channel);
  }
}

function requireWhatsappChannel(inst: Instance): WhatsappChannelConfig {
  const channel = findWhatsappChannel(inst.config.channels);
  if (!channel) throw new NotFoundError("whatsapp channel", inst.id);
  return channel;
}

function toView(inst: Instance, channel: WhatsappChannelConfig): WhatsappAccessView {
  const access = channel.dmAccess ?? "open";
  return {
    botNumber: inst.whatsappAccountId ? normalizeE164(inst.whatsappAccountId) : null,
    ownerNumber: channel.ownerNumber ?? null,
    access,
    configured: channel.dmAccess !== undefined,
    claiming: access === "owner" && !channel.ownerNumber,
  };
}

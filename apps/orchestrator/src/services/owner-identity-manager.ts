import type { FastifyBaseLogger } from "fastify";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import {
  findTelegramChannel,
  findWhatsappChannel,
  findWhatsappCloudChannel,
  replaceWhatsappChannel,
  replaceWhatsappCloudChannel,
} from "../domain/channels.js";
import {
  ownerIdentityOf,
  ownerPeerIds,
  sameOwnerIds,
  type OwnerIdentity,
} from "../domain/owner.js";
import { normalizeE164 } from "../domain/phone.js";
import {
  isContainerUp,
  type ChannelConfig,
  type Instance,
  type WhatsappChannelConfig,
  type WhatsappCloudChannelConfig,
} from "../domain/types.js";
import type { EventRepository } from "../storage/event-repository.js";
import type { HostRuntimes } from "./host-runtimes.js";
import type { WhatsappPairingRequest } from "./agent-runtime/types.js";
import type { InstanceManager } from "./instance-manager.js";

export const OWNER_SYNC_STATES = ["applied", "pending", "unavailable"] as const;
export type OwnerSyncState = (typeof OWNER_SYNC_STATES)[number];

export interface OwnerIdentityView {
  telegram: { userId: string; botUsername: string | null } | null;
  whatsappNumber: string | null;
  businessNumber: string | null;
  // Whether the live runtime config carries exactly these owner ids.
  sync: OwnerSyncState;
  // Senders held by WhatsApp claim mode — shortcuts for "this is me".
  candidates: WhatsappPairingRequest[];
  candidatesUnavailable: boolean;
}

// Undefined leaves that number as it is.
export interface OwnerIdentityUpdate {
  whatsappNumber?: string | null;
  businessNumber?: string | null;
}

interface Candidates {
  list: WhatsappPairingRequest[];
  unavailable: boolean;
}

const NO_CANDIDATES: Candidates = { list: [], unavailable: false };

export class OwnerIdentityManager {
  constructor(
    private readonly manager: InstanceManager,
    private readonly hosts: HostRuntimes,
    private readonly eventLog: EventRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async get(instanceId: string, userId: string): Promise<OwnerIdentityView> {
    const inst = await this.manager.get(instanceId, userId);
    const identity = ownerIdentityOf(inst.config.channels);
    const [sync, candidates] = await Promise.all([
      this.syncState(inst, identity),
      this.candidates(inst),
    ]);
    return toView(inst, identity, sync, candidates);
  }

  async update(
    instanceId: string,
    userId: string,
    patch: OwnerIdentityUpdate,
  ): Promise<OwnerIdentityView> {
    let businessChanged = false;
    const { instance, changed, outcome } = await this.manager.updateChannels(instanceId, userId, (channels) => {
      // Same number → the same array back: no config write, no container restart.
      let next = channels;
      if (patch.whatsappNumber !== undefined) next = withWhatsappOwner(next, patch.whatsappNumber, instanceId);
      if (patch.businessNumber !== undefined) {
        const withBusiness = withBusinessOwner(next, patch.businessNumber, instanceId);
        businessChanged = withBusiness !== next;
        next = withBusiness;
      }
      return next;
    });
    if (changed) {
      await this.eventLog.append(instanceId, "owner.identity_updated", {
        actor: userId,
        payload: {
          ...(patch.whatsappNumber !== undefined ? { whatsappSet: patch.whatsappNumber !== null } : {}),
          ...(patch.businessNumber !== undefined ? { businessSet: patch.businessNumber !== null } : {}),
        },
      });
    }
    // A container restart already started the plugin on the new routing; only a live apply needs the channel restarted.
    if (businessChanged && outcome === "applied") await this.restartBusinessChannel(instance);

    const identity = ownerIdentityOf(instance.config.channels);
    return toView(instance, identity, await this.syncState(instance, identity), NO_CANDIDATES);
  }

  // The config is saved either way; a channel left stopped is logged as an error, and the next bot restart revives it.
  private async restartBusinessChannel(inst: Instance): Promise<void> {
    if (!inst.containerId) return;
    try {
      const outcome = await this.hosts
        .for(inst.hostId)
        .adapters.get(inst.runtimeKind)
        .restartWhatsappCloudChannel(inst.containerId);
      if (outcome.status !== "started") {
        this.logger.error({ instanceId: inst.id, reason: outcome.reason }, "business channel not running after an owner number change");
      }
    } catch (err) {
      this.logger.error({ instanceId: inst.id, err }, "business channel restart failed");
    }
  }

  private async syncState(inst: Instance, identity: OwnerIdentity): Promise<OwnerSyncState> {
    if (!inst.containerId || !isContainerUp(inst.status)) return "unavailable";
    try {
      const live = await this.hosts.for(inst.hostId).adapters.get(inst.runtimeKind).readOwnerIds(inst.containerId);
      if (live === null) return "unavailable";
      return sameOwnerIds(live, ownerPeerIds(identity)) ? "applied" : "pending";
    } catch (err) {
      // Exec fails mid-restart; the caller re-polls, so report unavailability instead of failing the view.
      this.logger.warn({ instanceId: inst.id, err }, "owner ids read failed");
      return "unavailable";
    }
  }

  // Pending senders exist only in claim mode: owner-only access with no number yet.
  private async candidates(inst: Instance): Promise<Candidates> {
    const whatsapp = findWhatsappChannel(inst.config.channels);
    const claiming = whatsapp?.dmAccess === "owner" && !whatsapp.ownerNumber;
    if (!claiming || !inst.containerId || !isContainerUp(inst.status)) return NO_CANDIDATES;
    try {
      const list = await this.hosts
        .for(inst.hostId)
        .adapters.get(inst.runtimeKind)
        .listWhatsappPairingRequests(inst.containerId);
      return { list, unavailable: false };
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "whatsapp pairing list failed");
      return { list: [], unavailable: true };
    }
  }
}

function withWhatsappOwner(channels: ChannelConfig[], number: string | null, instanceId: string): ChannelConfig[] {
  const whatsapp = findWhatsappChannel(channels);
  if (!whatsapp) throw new NotFoundError("whatsapp channel", instanceId);
  const ownerNumber = normalizedOwnerNumber(number, "whatsappNumber");
  if (ownerNumber === (whatsapp.ownerNumber ?? null)) return channels;
  const next: WhatsappChannelConfig = { ...whatsapp };
  if (ownerNumber === null) delete next.ownerNumber;
  else next.ownerNumber = ownerNumber;
  return replaceWhatsappChannel(channels, next);
}

function withBusinessOwner(channels: ChannelConfig[], number: string | null, instanceId: string): ChannelConfig[] {
  const business = findWhatsappCloudChannel(channels);
  if (!business) throw new NotFoundError("whatsapp_cloud channel", instanceId);
  const ownerNumber = normalizedOwnerNumber(number, "businessNumber");
  if (ownerNumber !== null && ownerNumber === normalizeE164(business.displayPhoneNumber)) {
    throw new ValidationError("businessNumber is the business number itself; use the phone you write from");
  }
  if (ownerNumber === (business.ownerNumber ?? null)) return channels;
  const next: WhatsappCloudChannelConfig = { ...business };
  if (ownerNumber === null) delete next.ownerNumber;
  else next.ownerNumber = ownerNumber;
  return replaceWhatsappCloudChannel(channels, next);
}

function normalizedOwnerNumber(number: string | null, field: string): string | null {
  if (number === null) return null;
  const normalized = normalizeE164(number);
  if (!normalized) throw new ValidationError(`${field} must be E.164`);
  return normalized;
}

function toView(
  inst: Instance,
  identity: OwnerIdentity,
  sync: OwnerSyncState,
  candidates: Candidates,
): OwnerIdentityView {
  const telegram = findTelegramChannel(inst.config.channels);
  return {
    telegram: identity.telegramUserId
      ? { userId: identity.telegramUserId, botUsername: telegram?.botUsername ?? null }
      : null,
    whatsappNumber: identity.whatsappNumber,
    businessNumber: identity.businessOwnerNumber,
    sync,
    candidates: candidates.list,
    candidatesUnavailable: candidates.unavailable,
  };
}

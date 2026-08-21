import type { FastifyBaseLogger } from "fastify";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import {
  findTelegramChannel,
  findWhatsappChannel,
  replaceWhatsappChannel,
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
  type Instance,
  type WhatsappChannelConfig,
} from "../domain/types.js";
import type { EventRepository } from "../storage/event-repository.js";
import type { AgentRuntimeRegistry } from "./agent-runtime/registry.js";
import type { WhatsappPairingRequest } from "./agent-runtime/types.js";
import type { InstanceManager } from "./instance-manager.js";

export const OWNER_SYNC_STATES = ["applied", "pending", "unavailable"] as const;
export type OwnerSyncState = (typeof OWNER_SYNC_STATES)[number];

export interface OwnerIdentityView {
  telegram: { userId: string; botUsername: string | null } | null;
  whatsappNumber: string | null;
  // Whether the live runtime config carries exactly these owner ids.
  sync: OwnerSyncState;
  // Senders held by WhatsApp claim mode — shortcuts for "this is me".
  candidates: WhatsappPairingRequest[];
  candidatesUnavailable: boolean;
}

export interface OwnerIdentityUpdate {
  whatsappNumber: string | null;
}

interface Candidates {
  list: WhatsappPairingRequest[];
  unavailable: boolean;
}

const NO_CANDIDATES: Candidates = { list: [], unavailable: false };

export class OwnerIdentityManager {
  constructor(
    private readonly manager: InstanceManager,
    private readonly runtimes: AgentRuntimeRegistry,
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
    const { instance, changed } = await this.manager.updateChannels(
      instanceId,
      userId,
      (channels) => {
        const whatsapp = findWhatsappChannel(channels);
        if (!whatsapp) throw new NotFoundError("whatsapp channel", instanceId);
        const next = withOwnerNumber(whatsapp, patch.whatsappNumber);
        // Same number → no config write, no container restart.
        if ((next.ownerNumber ?? null) === (whatsapp.ownerNumber ?? null)) return channels;
        return replaceWhatsappChannel(channels, next);
      },
    );
    if (changed) {
      await this.eventLog.append(instanceId, "owner.identity_updated", {
        actor: userId,
        payload: { whatsappSet: patch.whatsappNumber !== null },
      });
    }

    const identity = ownerIdentityOf(instance.config.channels);
    return toView(instance, identity, await this.syncState(instance, identity), NO_CANDIDATES);
  }

  private async syncState(inst: Instance, identity: OwnerIdentity): Promise<OwnerSyncState> {
    if (!inst.containerId || !isContainerUp(inst.status)) return "unavailable";
    try {
      const live = await this.runtimes.get(inst.runtimeKind).readOwnerIds(inst.containerId);
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
      const list = await this.runtimes
        .get(inst.runtimeKind)
        .listWhatsappPairingRequests(inst.containerId);
      return { list, unavailable: false };
    } catch (err) {
      this.logger.warn({ instanceId: inst.id, err }, "whatsapp pairing list failed");
      return { list: [], unavailable: true };
    }
  }
}

function withOwnerNumber(
  channel: WhatsappChannelConfig,
  whatsappNumber: string | null,
): WhatsappChannelConfig {
  const next: WhatsappChannelConfig = { ...channel };
  if (whatsappNumber === null) {
    delete next.ownerNumber;
    return next;
  }
  const normalized = normalizeE164(whatsappNumber);
  if (!normalized) throw new ValidationError("whatsappNumber must be E.164");
  next.ownerNumber = normalized;
  return next;
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
    sync,
    candidates: candidates.list,
    candidatesUnavailable: candidates.unavailable,
  };
}

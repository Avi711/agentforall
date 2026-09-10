import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { findTelegramChannel, findWhatsappCloudChannel } from "../../domain/channels.js";
import {
  AuthenticationError,
  ChannelCredentialError,
  ChannelPinRequiredError,
  ConflictError,
  CustomerWindowClosedError,
  DomainError,
  InvalidStateError,
  MediaTooLargeError,
  NotFoundError,
  OwnerUnreachableError,
  UpstreamRateLimitedError,
  UpstreamUnavailableError,
  ValidationError,
  errorMessage,
} from "../../domain/errors.js";
import { ownerIdentityOf } from "../../domain/owner.js";
import type { Instance, WhatsappCloudChannelConfig } from "../../domain/types.js";
import type {
  ChannelHealth,
  ConnectInput,
  Conversation,
  ConversationMode,
  EscalationKind,
  InboundMessage,
  PhoneNumberFacts,
  SendTextInput,
  WhatsappCloudView,
} from "../../domain/whatsapp-cloud.js";
import {
  ESCALATION_KEYS_MAX,
  ESCALATION_MIN_INTERVAL_MS,
  ESCALATION_WINDOW_MS,
  ESCALATIONS_PER_BOT_PER_MINUTE,
  HEALTH_CACHE_MS,
  OWNER_MESSAGE_MAX_CHARS,
  PROFILE_NAME_MAX_CHARS,
  SEND_RATE_PER_SECOND,
  isWithinCustomerWindow,
} from "../../domain/whatsapp-cloud.js";
import type { EventRepository } from "../../storage/event-repository.js";
import type { InstanceRepository } from "../../storage/instance-repository.js";
import type { WhatsappCloudRepository } from "../../storage/whatsapp-cloud-repository.js";
import type { InstanceManager } from "../instance-manager.js";
import { InstanceOperationLock } from "../instance-operation-lock.js";
import { TelegramApiError, TelegramBotApi } from "../telegram/bot-api.js";
import {
  META_CREDENTIAL_CODES,
  META_ERROR_PIN_MISMATCH,
  META_ERROR_REENGAGEMENT,
  META_THROTTLE_CODES,
  MetaGraphError,
  type MediaDownload,
  type MetaGraphClient,
} from "./graph-client.js";
import type { InboxDispatcher } from "./inbox-dispatcher.js";
import { freshPin, whatsappCloudBindingFor } from "./relay-binding.js";
import { TokenBuckets } from "./token-bucket.js";

type Instances = Pick<InstanceManager, "get" | "updateChannels">;
type InstanceStore = Pick<InstanceRepository, "findById">;
type ChannelStore = Pick<
  WhatsappCloudRepository,
  | "findNumber"
  | "bindNumber"
  | "releaseNumber"
  | "purgeInstance"
  | "findConversation"
  | "touchOutbound"
  | "setMode"
  | "recordSend"
  | "ack"
>;
type Inbox = Pick<InboxDispatcher, "wait">;
type EventLog = Pick<EventRepository, "append">;
type Graph = Pick<
  MetaGraphClient,
  | "subscribeApp"
  | "unsubscribeApp"
  | "registerNumber"
  | "deregisterNumber"
  | "getPhoneNumber"
  | "sendText"
  | "markRead"
  | "getMediaLocation"
  | "downloadMedia"
>;
type OwnerMessenger = Pick<TelegramBotApi, "sendMessage">;
export type OwnerMessengerFactory = (botToken: string) => OwnerMessenger;

export interface WhatsappCloudManagerConfig {
  orchestratorInternalUrl: string;
}

export interface RelayContext {
  instance: Instance;
  channel: WhatsappCloudChannelConfig;
}

export interface EscalationInput {
  waId: string;
  summary: string;
  kind: EscalationKind;
}

export interface EscalationResult {
  notified: boolean;
  // A forward with nobody to forward to hands the customer back to the bot.
  fallbackToBot: boolean;
}

interface OwnerTarget {
  botToken: string;
  chatId: number;
}

interface CachedHealth {
  health: ChannelHealth;
  at: number;
}

// One per admitted escalation; released by identity, so a failed delivery frees exactly its own slot.
interface EscalationToken {
  at: number;
}

const CHANNEL_LABEL = "WhatsApp Business";
const NOT_CONNECTED: WhatsappCloudView = { status: "none", phoneNumberId: null, wabaId: null, displayPhoneNumber: null, verifiedName: null, health: null };
const ZERO_WIDTH_JOINER = "\u200D";

// Owner delivery is a plain Bot API message from the orchestrator: no agent turn, so customer text is never an instruction.
export class WhatsappCloudManager {
  private readonly lastEscalationAt = new Map<string, number>();
  private readonly escalationsPerBot = new Map<string, EscalationToken[]>();
  private readonly tokenInvalidReported = new Set<string>();
  private readonly healthCache = new Map<string, CachedHealth>();
  private readonly sendBuckets: TokenBuckets;
  // Connect and disconnect read, talk to Meta, then write; two at once for one bot would race on the PIN and the row.
  private readonly channelOps = new InstanceOperationLock();

  constructor(
    private readonly instances: Instances,
    private readonly store: InstanceStore,
    private readonly repo: ChannelStore,
    private readonly graph: Graph,
    private readonly dispatcher: Inbox,
    private readonly eventLog: EventLog,
    private readonly config: WhatsappCloudManagerConfig,
    private readonly log: FastifyBaseLogger,
    private readonly ownerMessenger: OwnerMessengerFactory = (token) => new TelegramBotApi(token),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sendBuckets = new TokenBuckets(SEND_RATE_PER_SECOND, now);
  }

  // Every step is idempotent, so a half-finished connect is simply run again by the user.
  connect(instanceId: string, userId: string, input: ConnectInput): Promise<WhatsappCloudView> {
    return this.channelOps.run(instanceId, () => this.connectLocked(instanceId, userId, input));
  }

  private async connectLocked(instanceId: string, userId: string, input: ConnectInput): Promise<WhatsappCloudView> {
    const inst = await this.instances.get(instanceId, userId);
    if (!acceptsChannels(inst)) throw new InvalidStateError(inst.status, "whatsapp cloud connect");
    const existing = findWhatsappCloudChannel(inst.config.channels);
    if (existing) {
      if (existing.phoneNumberId !== input.phoneNumberId) {
        throw new ConflictError("this bot already has a WhatsApp Business number; disconnect it first");
      }
      return this.refresh(instanceId, userId, existing, input);
    }

    const known = await this.repo.findNumber(input.phoneNumberId);
    if (known?.instanceId && known.instanceId !== instanceId) {
      throw new ConflictError("this WhatsApp number is already connected to a bot");
    }
    const pin = input.pin ?? known?.pin ?? freshPin();
    const binding = whatsappCloudBindingFor(instanceId, this.config.orchestratorInternalUrl);
    const facts = await this.registerAtMeta(input, pin);
    // A stale row from an earlier number of this bot would otherwise collide on instance_id.
    await this.repo.releaseNumber(instanceId);
    await this.repo.bindNumber({ phoneNumberId: input.phoneNumberId, instanceId, wabaId: input.wabaId, pin });

    const channel: WhatsappCloudChannelConfig = {
      type: "whatsapp_cloud",
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      businessId: input.businessId,
      displayPhoneNumber: facts.displayPhoneNumber,
      verifiedName: facts.verifiedName,
      accessToken: input.accessToken,
      pin,
      relayToken: binding.relayToken,
      relayUrl: binding.relayUrl,
    };
    try {
      await this.instances.updateChannels(instanceId, userId, (channels) =>
        findWhatsappCloudChannel(channels) ? channels : [...channels, channel],
      );
    } catch (err) {
      await this.repo.releaseNumber(instanceId).catch((releaseErr) =>
        this.log.warn({ instanceId, err: errorMessage(releaseErr) }, "whatsapp cloud number release after failed connect"),
      );
      throw err;
    }
    this.forgetHealth(instanceId);
    await this.eventLog.append(instanceId, "whatsapp_cloud.connected", {
      actor: userId,
      payload: { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId },
    });
    return this.viewOf(channel, "ok");
  }

  // Same number again: the popup minted a new token (a revoked one is the usual reason), so store it.
  private async refresh(
    instanceId: string,
    userId: string,
    existing: WhatsappCloudChannelConfig,
    input: ConnectInput,
  ): Promise<WhatsappCloudView> {
    const known = await this.repo.findNumber(existing.phoneNumberId);
    if (known?.instanceId && known.instanceId !== instanceId) {
      throw new ConflictError("this WhatsApp number is already connected to a bot");
    }
    // The row holds the PIN Meta was last told; the channel copy can lag a connect that raced this one.
    const pin = input.pin ?? known?.pin ?? existing.pin;
    const facts = await this.registerAtMeta(input, pin);
    await this.repo.bindNumber({ phoneNumberId: existing.phoneNumberId, instanceId, wabaId: input.wabaId, pin });
    const refreshed: WhatsappCloudChannelConfig = { ...existing, ...facts, wabaId: input.wabaId, accessToken: input.accessToken, pin };
    await this.instances.updateChannels(instanceId, userId, (channels) =>
      channels.map((ch) => (ch.type === "whatsapp_cloud" ? refreshed : ch)),
    );
    this.forgetHealth(instanceId);
    await this.eventLog.append(instanceId, "whatsapp_cloud.reconnected", {
      actor: userId,
      payload: { phoneNumberId: existing.phoneNumberId },
    });
    return this.viewOf(refreshed, "ok");
  }

  private registerAtMeta(input: ConnectInput, pin: string): Promise<PhoneNumberFacts> {
    return this.upstream(async () => {
      await this.graph.subscribeApp(input.wabaId, input.accessToken);
      await this.graph.registerNumber(input.phoneNumberId, input.accessToken, pin);
      return this.graph.getPhoneNumber(input.phoneNumberId, input.accessToken);
    });
  }

  // Release first so the webhook stops queueing; Meta is told only if the number is still ours.
  disconnect(instanceId: string, userId: string): Promise<void> {
    return this.channelOps.run(instanceId, () => this.disconnectLocked(instanceId, userId));
  }

  private async disconnectLocked(instanceId: string, userId: string): Promise<void> {
    const inst = await this.instances.get(instanceId, userId);
    const channel = findWhatsappCloudChannel(inst.config.channels);
    await this.repo.releaseNumber(instanceId);
    if (channel) {
      if (await this.stillOurs(instanceId, channel)) await this.leaveMeta(instanceId, channel, "disconnect");
      await this.instances.updateChannels(instanceId, userId, (channels) =>
        channels.some((ch) => ch.type === "whatsapp_cloud")
          ? channels.filter((ch) => ch.type !== "whatsapp_cloud")
          : channels,
      );
    }
    await this.repo.purgeInstance(instanceId);
    this.forgetHealth(instanceId);
    if (!channel) return;
    await this.eventLog.append(instanceId, "whatsapp_cloud.disconnected", {
      actor: userId,
      payload: { phoneNumberId: channel.phoneNumberId },
    });
  }

  // Destroy path: the bot is going away, so only Meta and our own tables need cleaning. Waits for a connect in flight.
  cleanupForDestroy(inst: Instance): Promise<void> {
    return this.channelOps.run(inst.id, async () => {
      const channel = findWhatsappCloudChannel(inst.config.channels);
      if (!channel) return;
      await this.repo.releaseNumber(inst.id);
      if (await this.stillOurs(inst.id, channel)) await this.leaveMeta(inst.id, channel, "destroy");
      await this.repo.purgeInstance(inst.id);
      this.forgetHealth(inst.id);
    });
  }

  async status(instanceId: string, userId: string): Promise<WhatsappCloudView> {
    const inst = await this.instances.get(instanceId, userId);
    const channel = findWhatsappCloudChannel(inst.config.channels);
    if (!channel) return NOT_CONNECTED;
    return this.viewOf(channel, await this.health(inst, channel));
  }

  // Bearer from the container is the only proof of identity; every failure looks the same.
  async resolveRelay(instanceId: string, bearer: string): Promise<RelayContext> {
    const instance = await this.store.findById(instanceId);
    if (!instance || !isLive(instance)) throw new AuthenticationError();
    const channel = findWhatsappCloudChannel(instance.config.channels);
    if (!channel || !tokensMatch(bearer, channel.relayToken)) throw new AuthenticationError();
    return { instance, channel };
  }

  pull(instanceId: string, waitMs: number): Promise<InboundMessage[]> {
    return this.dispatcher.wait(instanceId, waitMs);
  }

  ack(instanceId: string, ids: bigint[]): Promise<number> {
    return this.repo.ack(instanceId, ids);
  }

  // The window rule is enforced here, not trusted to the model: outside 24h only templates may go out.
  async send(ctx: RelayContext, input: SendTextInput): Promise<string> {
    const conversation = await this.repo.findConversation(ctx.instance.id, input.to);
    if (!isWithinCustomerWindow(conversation?.lastInboundAt ?? null, this.now())) {
      throw new CustomerWindowClosedError();
    }
    if (!this.sendBuckets.take(ctx.channel.phoneNumberId)) throw new UpstreamRateLimitedError("WhatsApp");
    const wamid = await this.upstream(
      () =>
        this.graph.sendText(ctx.channel.phoneNumberId, ctx.channel.accessToken, {
          to: input.to,
          text: input.text,
          ...(input.replyToId ? { replyToId: input.replyToId } : {}),
        }),
      ctx,
    );
    // Meta has the message; failing now would make the plugin send it again.
    try {
      await this.repo.touchOutbound(ctx.instance.id, input.to, this.now());
      await this.repo.recordSend({ instanceId: ctx.instance.id, waId: input.to, wamid, kind: input.kind });
    } catch (err) {
      this.log.warn({ instanceId: ctx.instance.id, wamid, err: errorMessage(err) }, "whatsapp cloud send bookkeeping failed");
    }
    return wamid;
  }

  async markRead(ctx: RelayContext, wamid: string, typing: boolean): Promise<void> {
    await this.upstream(() => this.graph.markRead(ctx.channel.phoneNumberId, ctx.channel.accessToken, wamid, typing), ctx);
  }

  async media(ctx: RelayContext, mediaId: string, signal: AbortSignal): Promise<MediaDownload> {
    return this.upstream(async () => {
      const location = await this.graph.getMediaLocation(mediaId, ctx.channel.accessToken);
      return this.graph.downloadMedia(location, ctx.channel.accessToken, signal);
    }, ctx);
  }

  conversation(ctx: RelayContext, waId: string): Promise<Conversation | null> {
    return this.repo.findConversation(ctx.instance.id, waId);
  }

  // Handing a customer to a human needs a human to hand them to.
  async setMode(ctx: RelayContext, waId: string, mode: ConversationMode): Promise<Conversation> {
    if (mode === "human" && !ownerTarget(ctx.instance)) {
      throw new ValidationError("this bot has no Telegram owner to hand the conversation to");
    }
    const updated = await this.repo.setMode(ctx.instance.id, waId, mode);
    if (!updated) throw new NotFoundError("conversation", waId);
    await this.eventLog.append(ctx.instance.id, "whatsapp_cloud.handoff", { payload: { waId, mode } });
    return updated;
  }

  // Only a real customer of this bot can be escalated; the owner is chosen by config, never by the model.
  async escalate(ctx: RelayContext, input: EscalationInput): Promise<EscalationResult> {
    const conversation = await this.repo.findConversation(ctx.instance.id, input.waId);
    if (!conversation) throw new NotFoundError("conversation", input.waId);
    const target = ownerTarget(ctx.instance);
    if (!target) {
      if (input.kind === "forward") return this.handBackToBot(ctx, input.waId, "owner_missing");
      throw new ValidationError("this bot has no Telegram owner to escalate to");
    }
    const slot = this.reserveEscalation(ctx.instance.id, input.waId, input.kind);
    if (!slot) return { notified: false, fallbackToBot: false };
    const name = conversation.profileName ? oneLine(conversation.profileName, PROFILE_NAME_MAX_CHARS) : null;
    const who = name ? `${name} (+${input.waId})` : `+${input.waId}`;
    const lead = input.kind === "forward" ? `לקוח ב-${CHANNEL_LABEL} כתב לך (השיחה אצלך):` : `לקוח ב-${CHANNEL_LABEL} מבקש אותך.`;
    try {
      await this.messageOwner(ctx.instance, target, `${lead}\nמי: ${who}\nמה: ${oneLine(input.summary, OWNER_MESSAGE_MAX_CHARS)}`);
    } catch (err) {
      slot.release();
      if (err instanceof OwnerUnreachableError && input.kind === "forward") return this.handBackToBot(ctx, input.waId, "owner_unreachable");
      throw err;
    }
    await this.eventLog.append(ctx.instance.id, "whatsapp_cloud.escalated", { payload: { waId: input.waId, kind: input.kind } });
    return { notified: true, fallbackToBot: false };
  }

  // A customer parked with a human who is gone would otherwise wait forever; the bot answers again.
  private async handBackToBot(ctx: RelayContext, waId: string, reason: string): Promise<EscalationResult> {
    await this.repo.setMode(ctx.instance.id, waId, "bot");
    await this.eventLog.append(ctx.instance.id, "whatsapp_cloud.handoff", { payload: { waId, mode: "bot", reason } });
    this.log.warn({ instanceId: ctx.instance.id, reason }, "whatsapp cloud conversation handed back to the bot");
    return { notified: false, fallbackToBot: true };
  }

  // Taken before the Telegram call so concurrent escalations cannot all pass the cap; a failed delivery gives it back.
  private reserveEscalation(instanceId: string, waId: string, kind: EscalationKind): { release(): void } | null {
    const nowMs = this.now().getTime();
    const tokens = this.escalationsPerBot.get(instanceId) ?? [];
    this.escalationsPerBot.set(instanceId, tokens);
    // Pruned in place: every reservation and release must see the same array.
    while (tokens.length > 0 && nowMs - tokens[0]!.at >= ESCALATION_WINDOW_MS) tokens.shift();
    if (tokens.length >= ESCALATIONS_PER_BOT_PER_MINUTE) {
      this.log.warn({ instanceId }, "whatsapp cloud escalation cap reached");
      return null;
    }
    const key = `${instanceId}:${waId}`;
    const last = this.lastEscalationAt.get(key);
    if (kind === "request" && last !== undefined && nowMs - last < ESCALATION_MIN_INTERVAL_MS) return null;
    const token: EscalationToken = { at: nowMs };
    tokens.push(token);
    if (kind === "request") this.stampCustomer(key, nowMs);
    return {
      release: () => {
        const at = tokens.indexOf(token);
        if (at >= 0) tokens.splice(at, 1);
        if (kind !== "request") return;
        if (last === undefined) this.lastEscalationAt.delete(key);
        else this.stampCustomer(key, last);
      },
    };
  }

  private stampCustomer(key: string, at: number): void {
    this.lastEscalationAt.delete(key);
    if (this.lastEscalationAt.size >= ESCALATION_KEYS_MAX) {
      const oldest = this.lastEscalationAt.keys().next().value;
      if (oldest !== undefined) this.lastEscalationAt.delete(oldest);
    }
    this.lastEscalationAt.set(key, at);
  }

  // 403 (owner blocked the bot) and 400 chat not found (owner never pressed Start) do not heal by retrying.
  private async messageOwner(inst: Instance, target: OwnerTarget, text: string): Promise<void> {
    try {
      await this.ownerMessenger(target.botToken).sendMessage(target.chatId, text);
    } catch (err) {
      this.log.warn({ instanceId: inst.id, err: errorMessage(err) }, "whatsapp cloud owner message failed");
      if (err instanceof TelegramApiError && (err.errorCode === 403 || err.errorCode === 400)) throw new OwnerUnreachableError();
      throw new UpstreamUnavailableError("Telegram");
    }
  }

  private async stillOurs(instanceId: string, channel: WhatsappCloudChannelConfig): Promise<boolean> {
    const record = await this.repo.findNumber(channel.phoneNumberId);
    return record === null || record.instanceId === null || record.instanceId === instanceId;
  }

  private async leaveMeta(instanceId: string, channel: WhatsappCloudChannelConfig, step: string): Promise<void> {
    const warn = (call: string) => (err: unknown) =>
      this.log.warn({ instanceId, step, call, err: errorMessage(err) }, "whatsapp cloud meta cleanup failed");
    await this.graph.unsubscribeApp(channel.wabaId, channel.accessToken).catch(warn("unsubscribe"));
    await this.graph.deregisterNumber(channel.phoneNumberId, channel.accessToken).catch(warn("deregister"));
  }

  // One Graph call per minute per bot at most: the dashboard polls, Meta's app-level limit is shared by all tenants.
  private async health(inst: Instance, channel: WhatsappCloudChannelConfig): Promise<ChannelHealth> {
    const cached = this.healthCache.get(inst.id);
    const nowMs = this.now().getTime();
    if (cached && nowMs - cached.at < HEALTH_CACHE_MS) return cached.health;
    const health = await this.probeHealth(inst, channel);
    this.healthCache.set(inst.id, { health, at: nowMs });
    return health;
  }

  private async probeHealth(inst: Instance, channel: WhatsappCloudChannelConfig): Promise<ChannelHealth> {
    try {
      await this.graph.getPhoneNumber(channel.phoneNumberId, channel.accessToken);
      return "ok";
    } catch (err) {
      if (err instanceof MetaGraphError && isCredentialFailure(err)) {
        await this.reportTokenInvalid(inst, channel);
        return "token_invalid";
      }
      this.log.warn({ phoneNumberId: channel.phoneNumberId, err: errorMessage(err) }, "whatsapp cloud health probe failed");
      return "unknown";
    }
  }

  // Once per process per bot, and only once the owner has actually been told (or cannot be told at all).
  private async reportTokenInvalid(inst: Instance, channel: WhatsappCloudChannelConfig): Promise<void> {
    if (this.tokenInvalidReported.has(inst.id)) return;
    const target = ownerTarget(inst);
    if (target) {
      try {
        await this.messageOwner(
          inst,
          target,
          `החיבור של המספר העסקי ${channel.displayPhoneNumber} ל-Meta פג. הסוכן לא עונה ללקוחות עד שמחברים אותו מחדש מהדשבורד.`,
        );
      } catch (err) {
        // Telegram is down for now: the next Meta failure tries again. An owner who cannot be reached never will be.
        if (!(err instanceof OwnerUnreachableError)) return;
      }
    }
    this.tokenInvalidReported.add(inst.id);
    await this.eventLog
      .append(inst.id, "whatsapp_cloud.token_invalid", { payload: { phoneNumberId: channel.phoneNumberId } })
      .catch((err) => this.log.warn({ instanceId: inst.id, err: errorMessage(err) }, "whatsapp cloud token event failed"));
  }

  private forgetHealth(instanceId: string): void {
    this.healthCache.delete(instanceId);
    this.tokenInvalidReported.delete(instanceId);
    this.escalationsPerBot.delete(instanceId);
    for (const key of this.lastEscalationAt.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.lastEscalationAt.delete(key);
    }
  }

  private viewOf(channel: WhatsappCloudChannelConfig, health: ChannelHealth): WhatsappCloudView {
    return {
      status: "connected",
      phoneNumberId: channel.phoneNumberId,
      wabaId: channel.wabaId,
      displayPhoneNumber: channel.displayPhoneNumber,
      verifiedName: channel.verifiedName,
      health,
    };
  }

  // Meta failures become domain errors the agent can act on; vendor detail stays in the log.
  private async upstream<T>(fn: () => Promise<T>, ctx?: RelayContext): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DomainError) throw err;
      if (err instanceof MetaGraphError) {
        this.log.warn({ status: err.status, code: err.code, path: err.path }, "meta graph call failed");
        if (isCredentialFailure(err)) {
          if (ctx) await this.reportTokenInvalid(ctx.instance, ctx.channel);
          throw new ChannelCredentialError(CHANNEL_LABEL);
        }
        if (err.code === META_ERROR_PIN_MISMATCH) throw new ChannelPinRequiredError();
        if (err.code === META_ERROR_REENGAGEMENT) throw new CustomerWindowClosedError();
        if ((err.code !== null && META_THROTTLE_CODES.has(err.code)) || err.status === 429) {
          throw new UpstreamRateLimitedError("WhatsApp");
        }
        if (err.status === 413) throw new MediaTooLargeError();
        if (err.status >= 400 && err.status < 500) throw new ValidationError(`WhatsApp rejected the request (code ${err.code ?? err.status})`);
      } else {
        this.log.warn({ err: errorMessage(err) }, "meta graph call failed");
      }
      throw new UpstreamUnavailableError("WhatsApp");
    }
  }
}

// The Telegram DM chat id of a user is their user id; the bot token is the tenant's own managed bot.
function ownerTarget(inst: Instance): OwnerTarget | null {
  const telegram = findTelegramChannel(inst.config.channels);
  const identity = ownerIdentityOf(inst.config.channels);
  if (!telegram?.botToken || !identity.telegramUserId) return null;
  const chatId = Number(identity.telegramUserId);
  return Number.isSafeInteger(chatId) ? { botToken: telegram.botToken, chatId } : null;
}

function isCredentialFailure(err: MetaGraphError): boolean {
  return (err.code !== null && META_CREDENTIAL_CODES.has(err.code)) || (err.status === 401 && err.code === null);
}

function isLive(inst: Instance): boolean {
  return inst.status !== "destroying" && inst.status !== "destroyed";
}

// Meta must not be told about a number for a bot that cannot take the channel yet or is on its way out.
function acceptsChannels(inst: Instance): boolean {
  return isLive(inst) && inst.status !== "provisioning";
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Control and format characters (bidi overrides included) go; the ZWJ stays so joined emoji survive; counts code points.
function oneLine(value: string, max: number): string {
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, (ch) => (ch === ZERO_WIDTH_JOINER ? ch : " "));
  return Array.from(cleaned.replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

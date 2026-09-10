import {
  WHATSAPP_CLOUD_CONVERSATION_MODES,
  WHATSAPP_CLOUD_OWNER_ECHO_KIND,
  WHATSAPP_CLOUD_PARTNER_REMOVED_KIND,
  WHATSAPP_CLOUD_SEND_KINDS,
} from "@agent-forall/db";

export { WHATSAPP_CLOUD_CONVERSATION_MODES, WHATSAPP_CLOUD_OWNER_ECHO_KIND, WHATSAPP_CLOUD_PARTNER_REMOVED_KIND, WHATSAPP_CLOUD_SEND_KINDS };
export type ConversationMode = (typeof WHATSAPP_CLOUD_CONVERSATION_MODES)[number];
export type SendKind = (typeof WHATSAPP_CLOUD_SEND_KINDS)[number];

// Meta's wa_id: E.164 digits without the plus.
export const WA_ID_PATTERN = /^\d{6,20}$/;
export const PHONE_NUMBER_ID_PATTERN = /^\d{1,64}$/;

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INBOX_LEASE_MS = 60_000;
// Meta retries a webhook for up to 7 days; nothing older can arrive from anyone. Attempts are telemetry only.
export const INBOX_DROP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
// An acked row keeps its wamid past Meta's retry horizon so a late redelivery stays a no-op.
export const INBOX_RETAIN_ACKED_MS = 8 * 24 * 60 * 60 * 1000;
// Customer phone numbers are PII: a ledger row idle this long, or an audit row this old, is deleted.
export const CONVERSATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SENDS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// Meta's own ceiling for a media file.
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const HEALTH_CACHE_MS = 60_000;
// Meta's default per-number throughput; we stop before Meta answers 130429.
export const SEND_RATE_PER_SECOND = 80;
// Meta's fixed throughput for a number shared with the WhatsApp Business app.
export const COEXISTENCE_SEND_RATE_PER_SECOND = 20;
// After the owner answers a customer from the app the bot stays out for a day from that message (Meta's own handover lapse).
export const OWNER_HOLD_MS = 24 * 60 * 60 * 1000;
// Telegram's message limit is 4096; the lead lines take the rest.
export const OWNER_MESSAGE_MAX_CHARS = 3500;
export const PROFILE_NAME_MAX_CHARS = 80;
// What the relay accepts as a summary; the owner message is cut to OWNER_MESSAGE_MAX_CHARS after cleaning.
export const ESCALATION_SUMMARY_MAX_CHARS = 4096;
export const INBOX_MAX_BATCH = 50;
export const INBOX_MAX_WAIT_MS = 25_000;
// A bot whose oldest unacked row is this old is not being served; the sweeper says so in the log.
export const INBOX_BACKLOG_WARN_MS = 60 * 60 * 1000;
// Meta's text limit, counted in UTF-16 units so a Zod max and a chunk agree.
export const SEND_TEXT_MAX_CHARS = 4096;
export const PIN_PATTERN = /^\d{6}$/;
// A model in a loop must not page the owner more often than this per customer.
export const ESCALATION_MIN_INTERVAL_MS = 2 * 60 * 1000;
// Above this a bot is not escalating, it is flooding the owner (or a container is).
export const ESCALATIONS_PER_BOT_PER_MINUTE = 60;
export const ESCALATION_WINDOW_MS = 60_000;
export const ESCALATION_KEYS_MAX = 10_000;
// Per socket peer: one container cannot starve the relay for the others on the host.
export const RELAY_RATE_LIMIT_PER_MINUTE = 600;
export const RELAY_MAX_BODY_BYTES = 64 * 1024;
export const TOKEN_BUCKET_PRUNE_AT = 1000;
export const ESCALATION_KINDS = ["request", "forward"] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

// Meta's two one-shot syncs for a number that stays in the WhatsApp Business app: contacts first, then history.
export const APP_DATA_SYNC_TYPES = ["smb_app_state_sync", "history"] as const;
export type AppDataSyncType = (typeof APP_DATA_SYNC_TYPES)[number];

// Meta's coexistence popup may name only the account; the number is then looked up.
export interface ConnectInput {
  accessToken: string;
  phoneNumberId?: string;
  wabaId: string;
  businessId?: string;
  pin?: string;
  // The number stays in the WhatsApp Business app; Meta already registered it.
  coexistence?: boolean;
}

export type ChannelHealth = "ok" | "token_invalid" | "unknown";

export interface WhatsappCloudView {
  status: "none" | "connected";
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  health: ChannelHealth | null;
  // A coexistence number whose one-shot sync Meta has not accepted yet; reconnecting runs what is missing.
  syncPending: boolean;
}

// One queued customer message. `message` is Meta's own object, passed through to the plugin untouched.
export interface InboundMessage {
  id: string;
  wamid: string;
  from: string;
  profileName: string | null;
  timestamp: Date;
  message: Record<string, unknown>;
}

// The owner answered `to` from the WhatsApp Business app.
export interface OwnerEcho {
  kind: typeof WHATSAPP_CLOUD_OWNER_ECHO_KIND;
  id: string;
  wamid: string;
  to: string;
  timestamp: Date;
}

// A business removed our app inside WhatsApp Business; the orchestrator drops the number and the plugin never sees it.
export interface PartnerRemoved {
  kind: typeof WHATSAPP_CLOUD_PARTNER_REMOVED_KIND;
  id: string;
  wamid: string;
  wabaId: string;
  timestamp: Date;
}

export type InboxItem = InboundMessage | OwnerEcho | PartnerRemoved;

export function isOwnerEcho(item: InboxItem): item is OwnerEcho {
  return "kind" in item && item.kind === WHATSAPP_CLOUD_OWNER_ECHO_KIND;
}

export function isPartnerRemoved(item: InboxItem): item is PartnerRemoved {
  return "kind" in item && item.kind === WHATSAPP_CLOUD_PARTNER_REMOVED_KIND;
}

export function isCustomerMessage(item: InboxItem): item is InboundMessage {
  return !("kind" in item);
}

export interface Conversation {
  instanceId: string;
  waId: string;
  profileName: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  mode: ConversationMode;
  // Set when the owner answered from the app: the bot answers again after it. "human" with null is open-ended.
  heldUntil: Date | null;
  modeChangedAt: Date | null;
  updatedAt: Date;
}

export interface SendTextInput {
  to: string;
  text: string;
  replyToId?: string;
  kind: SendKind;
}

export interface PhoneNumberFacts {
  displayPhoneNumber: string;
  verifiedName: string;
  // Meta's is_on_biz_app; null when Meta did not say.
  isOnBizApp: boolean | null;
}

export interface ListedPhoneNumber extends PhoneNumberFacts {
  id: string;
}

export interface MediaLocation {
  url: string;
  mimeType: string;
}

export function isHeldByOwner(conversation: Pick<Conversation, "mode" | "heldUntil">, now: Date): boolean {
  return conversation.mode === "human" && (conversation.heldUntil === null || conversation.heldUntil.getTime() > now.getTime());
}

export function isWithinCustomerWindow(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < CUSTOMER_WINDOW_MS;
}

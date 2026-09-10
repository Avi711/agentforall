import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { types } from "pg";
import {
  instances,
  whatsappCloudConversations,
  whatsappCloudInbox,
  whatsappCloudNumbers,
  whatsappCloudSends,
  WHATSAPP_CLOUD_OWNER_ECHO_KIND,
  WHATSAPP_CLOUD_PARTNER_REMOVED_KIND,
} from "@agent-forall/db";
import { ConflictError } from "../domain/errors.js";
import {
  APP_DATA_SYNC_TYPES,
  PHONE_NUMBER_ID_PATTERN,
  WA_ID_PATTERN,
  isHeldByOwner,
  type AppDataSyncType,
  type Conversation,
  type ConversationMode,
  type InboxItem,
  type SendKind,
} from "../domain/whatsapp-cloud.js";
import { decrypt, encrypt } from "../services/crypto.js";
import { isUniqueViolation } from "./pg-errors.js";

type DB = NodePgDatabase<Record<string, never>>;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type ConversationRow = typeof whatsappCloudConversations.$inferSelect;

// A bot in either state never polls again; its number binding is dead weight for the webhook and a block for others.
const GONE_STATUSES = ["destroying", "destroyed"] as const;

export interface LeasedMessage {
  instanceId: string;
  item: InboxItem;
}

export interface LeaseResult {
  leased: LeasedMessage[];
  // Rows whose payload is none of the known kinds; they are dropped here so the plugin never sees them.
  malformed: number;
}

export interface SweepInput {
  dropBefore: Date;
  deleteAckedBefore: Date;
  deleteConversationsIdleBefore: Date;
  deleteSendsBefore: Date;
  backlogOlderThan: Date;
}

export interface DroppedMessage {
  instanceId: string;
  wamid: string;
  attempts: number;
}

export interface Backlog {
  instanceId: string;
  pending: number;
  oldestReceivedAt: Date;
}

export interface SweepResult {
  dropped: DroppedMessage[];
  // Bots whose oldest unacked row predates `backlogOlderThan`: the plugin is not keeping up or not polling.
  backlog: Backlog[];
  releasedNumbers: number;
}

export interface NumberRecord {
  phoneNumberId: string;
  instanceId: string | null;
  wabaId: string;
  pin: string | null;
  appDataSynced: AppDataSyncType[];
}

export interface OwnerEchoHold {
  id: bigint;
  to: string;
  at: Date;
}

export interface NumberBinding {
  phoneNumberId: string;
  instanceId: string;
  wabaId: string;
  pin: string | null;
}

// Drizzle's raw execute leaves timestamps (and int8) as the wire text; the driver's own parser turns them back.
const parseTimestamptz = types.getTypeParser(types.builtins.TIMESTAMPTZ);

const LeasedRow = {
  parse(row: Record<string, unknown>): { id: string; wamid: string; instanceId: string; waTimestamp: Date; payload: unknown } | null {
    const { id, wamid, instance_id: instanceId, wa_timestamp: rawTimestamp, payload } = row;
    if ((typeof id !== "string" && typeof id !== "number") || typeof wamid !== "string" || typeof instanceId !== "string") return null;
    const waTimestamp = rawTimestamp instanceof Date ? rawTimestamp : typeof rawTimestamp === "string" ? parseTimestamptz(rawTimestamp) : null;
    if (!(waTimestamp instanceof Date) || Number.isNaN(waTimestamp.getTime())) return null;
    return { id: String(id), wamid, instanceId, waTimestamp, payload: typeof payload === "string" ? parseJson(payload) : payload };
  },
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class WhatsappCloudRepository {
  constructor(
    private readonly db: DB,
    private readonly encryptionKey: Buffer,
  ) {}

  async findNumber(phoneNumberId: string): Promise<NumberRecord | null> {
    const rows = await this.db
      .select({ number: whatsappCloudNumbers, boundStatus: instances.status })
      .from(whatsappCloudNumbers)
      .leftJoin(instances, eq(instances.id, whatsappCloudNumbers.instanceId))
      .where(eq(whatsappCloudNumbers.phoneNumberId, phoneNumberId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const bound = row.boundStatus !== null && !GONE_STATUSES.some((s) => s === row.boundStatus);
    return {
      phoneNumberId: row.number.phoneNumberId,
      instanceId: bound ? row.number.instanceId : null,
      wabaId: row.number.wabaId,
      pin: row.number.pinEncrypted === null ? null : decrypt(row.number.pinEncrypted, this.encryptionKey),
      appDataSynced: APP_DATA_SYNC_TYPES.filter((syncType) => syncedAt(row.number, syncType) !== null),
    };
  }

  // Claims a free number or re-claims our own; a number live on another bot is a conflict, not a crash.
  async bindNumber(binding: NumberBinding): Promise<void> {
    const now = new Date();
    const pinEncrypted = binding.pin === null ? null : encrypt(binding.pin, this.encryptionKey);
    let claimed: { phoneNumberId: string }[];
    try {
      claimed = await this.db
        .insert(whatsappCloudNumbers)
        .values({ phoneNumberId: binding.phoneNumberId, instanceId: binding.instanceId, wabaId: binding.wabaId, pinEncrypted, updatedAt: now })
        .onConflictDoUpdate({
          target: whatsappCloudNumbers.phoneNumberId,
          set: { instanceId: binding.instanceId, wabaId: binding.wabaId, pinEncrypted, updatedAt: now },
          setWhere: or(
            isNull(whatsappCloudNumbers.instanceId),
            eq(whatsappCloudNumbers.instanceId, binding.instanceId),
            inArray(whatsappCloudNumbers.instanceId, this.goneInstances()),
          ),
        })
        .returning({ phoneNumberId: whatsappCloudNumbers.phoneNumberId });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("this bot already has a WhatsApp Business number");
      throw err;
    }
    if (claimed.length === 0) throw new ConflictError("this WhatsApp number is already connected to a bot");
  }

  async markAppDataSynced(phoneNumberId: string, syncType: AppDataSyncType, at: Date): Promise<void> {
    await this.db
      .update(whatsappCloudNumbers)
      .set(syncType === "history" ? { historySyncedAt: at, updatedAt: at } : { contactsSyncedAt: at, updatedAt: at })
      .where(eq(whatsappCloudNumbers.phoneNumberId, phoneNumberId));
  }

  // A new Meta signup needs its own syncs.
  async clearAppDataSync(phoneNumberId: string): Promise<void> {
    await this.db
      .update(whatsappCloudNumbers)
      .set({ contactsSyncedAt: null, historySyncedAt: null, updatedAt: new Date() })
      .where(eq(whatsappCloudNumbers.phoneNumberId, phoneNumberId));
  }

  // Keeps the row (and its PIN) so the number can come back to any bot later.
  async releaseNumber(instanceId: string): Promise<void> {
    await this.db
      .update(whatsappCloudNumbers)
      .set({ instanceId: null, updatedAt: new Date() })
      .where(eq(whatsappCloudNumbers.instanceId, instanceId));
  }

  // One statement for every waiting bot: oldest first, capped per bot, SKIP LOCKED against a second orchestrator.
  async leasePending(instanceIds: string[], limitPerInstance: number, leaseMs: number): Promise<LeaseResult> {
    if (instanceIds.length === 0) return { leased: [], malformed: 0 };
    const leasedUntil = new Date(Date.now() + leaseMs);
    const result = await this.db.execute(sql`
      with picked as (
        select candidate.id
        from unnest(${sql.param(instanceIds)}::uuid[]) as waiting(instance_id)
        cross join lateral (
          select inbox.id
          from ${whatsappCloudInbox} as inbox
          where inbox.instance_id = waiting.instance_id
            and inbox.acked_at is null
            and inbox.dropped_at is null
            and (inbox.leased_until is null or inbox.leased_until < now())
          order by inbox.wa_timestamp, inbox.id
          limit ${limitPerInstance}
          for update skip locked
        ) as candidate
      )
      update ${whatsappCloudInbox} as inbox
      set leased_until = ${leasedUntil}, attempts = inbox.attempts + 1
      from picked
      where inbox.id = picked.id
      returning inbox.id, inbox.wamid, inbox.instance_id, inbox.wa_timestamp, inbox.payload
    `);
    const leased: LeasedMessage[] = [];
    const malformedIds: bigint[] = [];
    for (const raw of result.rows) {
      const row = LeasedRow.parse(raw);
      const item = row ? toInboxItem(row) : null;
      if (row && item) leased.push({ instanceId: row.instanceId, item });
      else if (typeof raw.id === "string" || typeof raw.id === "number") malformedIds.push(BigInt(raw.id));
    }
    if (malformedIds.length > 0) await this.drop(malformedIds);
    leased.sort(byDelivery);
    return { leased, malformed: malformedIds.length };
  }

  // The payload goes with the ack; the wamid stays as the dedupe marker until the sweeper retires it.
  async ack(instanceId: string, ids: bigint[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(whatsappCloudInbox)
      .set({ ackedAt: new Date(), payload: null, leasedUntil: null })
      .where(
        and(
          eq(whatsappCloudInbox.instanceId, instanceId),
          inArray(whatsappCloudInbox.id, ids),
          isNull(whatsappCloudInbox.ackedAt),
        ),
      )
      .returning({ id: whatsappCloudInbox.id });
    return rows.length;
  }

  // Age is the only reason to give up on a message; an idle ledger row or an old audit row is PII past its use.
  async sweep(input: SweepInput): Promise<SweepResult> {
    const dropped = await this.db
      .update(whatsappCloudInbox)
      .set({ droppedAt: new Date(), payload: null, leasedUntil: null })
      .where(
        and(
          isNull(whatsappCloudInbox.ackedAt),
          isNull(whatsappCloudInbox.droppedAt),
          lt(whatsappCloudInbox.receivedAt, input.dropBefore),
        ),
      )
      .returning({
        instanceId: whatsappCloudInbox.instanceId,
        wamid: whatsappCloudInbox.wamid,
        attempts: whatsappCloudInbox.attempts,
      });
    await this.db
      .delete(whatsappCloudInbox)
      .where(
        or(
          lt(whatsappCloudInbox.ackedAt, input.deleteAckedBefore),
          lt(whatsappCloudInbox.droppedAt, input.deleteAckedBefore),
        ),
      );
    await this.db
      .delete(whatsappCloudConversations)
      .where(lt(whatsappCloudConversations.updatedAt, input.deleteConversationsIdleBefore));
    await this.db.delete(whatsappCloudSends).where(lt(whatsappCloudSends.createdAt, input.deleteSendsBefore));
    const released = await this.db
      .update(whatsappCloudNumbers)
      .set({ instanceId: null, updatedAt: new Date() })
      .where(inArray(whatsappCloudNumbers.instanceId, this.goneInstances()))
      .returning({ phoneNumberId: whatsappCloudNumbers.phoneNumberId });
    // mapWith: an aggregate has no column decoder of its own, and Drizzle leaves timestamps as text otherwise.
    const backlogRows = await this.db
      .select({
        instanceId: whatsappCloudInbox.instanceId,
        pending: sql<number>`count(*)::int`,
        oldestReceivedAt: sql`min(${whatsappCloudInbox.receivedAt})`.mapWith(whatsappCloudInbox.receivedAt),
      })
      .from(whatsappCloudInbox)
      .where(and(isNull(whatsappCloudInbox.ackedAt), isNull(whatsappCloudInbox.droppedAt)))
      .groupBy(whatsappCloudInbox.instanceId)
      .having(lt(sql`min(${whatsappCloudInbox.receivedAt})`, input.backlogOlderThan));
    return { dropped, backlog: backlogRows, releasedNumbers: released.length };
  }

  async findConversation(instanceId: string, waId: string): Promise<Conversation | null> {
    const rows = await this.db
      .select()
      .from(whatsappCloudConversations)
      .where(and(eq(whatsappCloudConversations.instanceId, instanceId), eq(whatsappCloudConversations.waId, waId)))
      .limit(1);
    const row = rows[0];
    return row ? toConversation(row) : null;
  }

  async touchOutbound(instanceId: string, waId: string, at: Date): Promise<void> {
    await this.db
      .insert(whatsappCloudConversations)
      .values({ instanceId, waId, lastOutboundAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: [whatsappCloudConversations.instanceId, whatsappCloudConversations.waId],
        set: { lastOutboundAt: at, updatedAt: at },
      });
  }

  // The owner answered from the WhatsApp Business app, or a customer asked for them on a bot with no Telegram.
  async holdForOwner(instanceId: string, waId: string, at: Date, holdMs: number): Promise<boolean> {
    return this.db.transaction((tx) => holdIn(tx, instanceId, waId, at, holdMs, new Date()));
  }

  // One transaction: a reply is never acked without its hold, nor held and then handed out again.
  async applyOwnerEchoes(instanceId: string, echoes: OwnerEchoHold[], holdMs: number): Promise<string[]> {
    if (echoes.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const held: string[] = [];
      // One lock order for every writer of these rows (the webhook sorts the same way), so no two wait on each other.
      for (const echo of [...echoes].sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))) {
        if (await holdIn(tx, instanceId, echo.to, echo.at, holdMs, now)) held.push(echo.to);
      }
      await tx
        .update(whatsappCloudInbox)
        .set({ ackedAt: now, payload: null, leasedUntil: null })
        .where(
          and(
            eq(whatsappCloudInbox.instanceId, instanceId),
            inArray(
              whatsappCloudInbox.id,
              echoes.map((echo) => echo.id),
            ),
            isNull(whatsappCloudInbox.ackedAt),
          ),
        );
      return held;
    });
  }

  // The owner's own choice: open-ended, and it outranks any app reply written before it.
  async setMode(instanceId: string, waId: string, mode: ConversationMode): Promise<Conversation | null> {
    const now = new Date();
    const rows = await this.db
      .update(whatsappCloudConversations)
      .set({ mode, heldUntil: null, modeChangedAt: now, updatedAt: now })
      .where(and(eq(whatsappCloudConversations.instanceId, instanceId), eq(whatsappCloudConversations.waId, waId)))
      .returning();
    const row = rows[0];
    return row ? toConversation(row) : null;
  }

  async recordSend(input: { instanceId: string; waId: string; wamid: string; kind: SendKind }): Promise<void> {
    await this.db.insert(whatsappCloudSends).values(input);
  }

  // Cascades cover a destroyed bot; a disconnect keeps the bot and must clear the number's state itself.
  async purgeInstance(instanceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(whatsappCloudInbox).where(eq(whatsappCloudInbox.instanceId, instanceId));
      await tx.delete(whatsappCloudConversations).where(eq(whatsappCloudConversations.instanceId, instanceId));
      await tx.delete(whatsappCloudSends).where(eq(whatsappCloudSends.instanceId, instanceId));
    });
  }

  private goneInstances() {
    return this.db.select({ id: instances.id }).from(instances).where(inArray(instances.status, [...GONE_STATUSES]));
  }

  private async drop(ids: bigint[]): Promise<void> {
    await this.db
      .update(whatsappCloudInbox)
      .set({ droppedAt: new Date(), payload: null, leasedUntil: null })
      .where(inArray(whatsappCloudInbox.id, ids));
  }
}

function byDelivery(a: LeasedMessage, b: LeasedMessage): number {
  const dt = a.item.timestamp.getTime() - b.item.timestamp.getTime();
  if (dt !== 0) return dt;
  const ai = BigInt(a.item.id);
  const bi = BigInt(b.item.id);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

function toInboxItem(row: { id: string; wamid: string; waTimestamp: Date; payload: unknown }): InboxItem | null {
  if (!isRecord(row.payload)) return null;
  if (row.payload.kind === WHATSAPP_CLOUD_OWNER_ECHO_KIND) {
    const to = row.payload.to;
    if (typeof to !== "string" || !WA_ID_PATTERN.test(to)) return null;
    return { kind: WHATSAPP_CLOUD_OWNER_ECHO_KIND, id: row.id, wamid: row.wamid, to, timestamp: row.waTimestamp };
  }
  if (row.payload.kind === WHATSAPP_CLOUD_PARTNER_REMOVED_KIND) {
    const wabaId = row.payload.wabaId;
    if (typeof wabaId !== "string" || !PHONE_NUMBER_ID_PATTERN.test(wabaId)) return null;
    return { kind: WHATSAPP_CLOUD_PARTNER_REMOVED_KIND, id: row.id, wamid: row.wamid, wabaId, timestamp: row.waTimestamp };
  }
  if (typeof row.payload.from !== "string" || !isRecord(row.payload.message)) return null;
  return {
    id: row.id,
    wamid: row.wamid,
    from: row.payload.from,
    profileName: typeof row.payload.profileName === "string" ? row.payload.profileName : null,
    timestamp: row.waTimestamp,
    message: row.payload.message,
  };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    instanceId: row.instanceId,
    waId: row.waId,
    profileName: row.profileName,
    lastInboundAt: row.lastInboundAt,
    lastOutboundAt: row.lastOutboundAt,
    mode: row.mode,
    heldUntil: row.heldUntil,
    modeChangedAt: row.modeChangedAt,
    updatedAt: row.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// True when this changed who answers. A reply older than the owner's own last choice, or older than a hold, holds nothing.
async function holdIn(tx: Tx, instanceId: string, waId: string, at: Date, holdMs: number, now: Date): Promise<boolean> {
  const until = at.getTime() + holdMs;
  if (until <= now.getTime()) return false;
  const [row] = await tx
    .select()
    .from(whatsappCloudConversations)
    .where(and(eq(whatsappCloudConversations.instanceId, instanceId), eq(whatsappCloudConversations.waId, waId)))
    .for("update");
  const current = row ? toConversation(row) : null;
  if (current?.modeChangedAt && current.modeChangedAt.getTime() > at.getTime()) return false;
  const wasHeld = current !== null && isHeldByOwner(current, now);
  // A hold the owner chose has no end, and an app reply never gives it one.
  const heldUntil = current?.mode === "human" && current.heldUntil === null ? null : new Date(Math.max(until, current?.heldUntil?.getTime() ?? 0));
  const modeChangedAt = wasHeld && current ? current.modeChangedAt : at;
  const updatedAt = sql`greatest(${whatsappCloudConversations.updatedAt}, excluded.updated_at)`;
  await tx
    .insert(whatsappCloudConversations)
    .values({ instanceId, waId, mode: "human", heldUntil, modeChangedAt, updatedAt: now })
    .onConflictDoUpdate({
      target: [whatsappCloudConversations.instanceId, whatsappCloudConversations.waId],
      // A row read under the lock takes the values worked out above; one created since the read is merged, never shortened.
      set: current
        ? { mode: "human", heldUntil, modeChangedAt, updatedAt }
        : {
            mode: "human",
            heldUntil: sql`greatest(${whatsappCloudConversations.heldUntil}, excluded.held_until)`,
            modeChangedAt: sql`coalesce(${whatsappCloudConversations.modeChangedAt}, excluded.mode_changed_at)`,
            updatedAt,
          },
    });
  return !wasHeld;
}

function syncedAt(number: typeof whatsappCloudNumbers.$inferSelect, syncType: AppDataSyncType): Date | null {
  return syncType === "history" ? number.historySyncedAt : number.contactsSyncedAt;
}

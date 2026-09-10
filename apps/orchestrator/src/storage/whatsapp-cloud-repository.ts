import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { types } from "pg";
import {
  instances,
  whatsappCloudConversations,
  whatsappCloudInbox,
  whatsappCloudNumbers,
  whatsappCloudSends,
} from "@agent-forall/db";
import { ConflictError } from "../domain/errors.js";
import type { Conversation, ConversationMode, InboundMessage, SendKind } from "../domain/whatsapp-cloud.js";
import { decrypt, encrypt } from "../services/crypto.js";
import { isUniqueViolation } from "./pg-errors.js";

type DB = NodePgDatabase<Record<string, never>>;
type ConversationRow = typeof whatsappCloudConversations.$inferSelect;

// A bot in either state never polls again; its number binding is dead weight for the webhook and a block for others.
const GONE_STATUSES = ["destroying", "destroyed"] as const;

export interface LeasedMessage {
  instanceId: string;
  message: InboundMessage;
}

export interface LeaseResult {
  leased: LeasedMessage[];
  // Rows whose payload is not a message; they are dropped here so the plugin never sees them.
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
  pin: string;
}

export interface NumberBinding {
  phoneNumberId: string;
  instanceId: string;
  wabaId: string;
  pin: string;
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
      pin: decrypt(row.number.pinEncrypted, this.encryptionKey),
    };
  }

  // Claims a free number or re-claims our own; a number live on another bot is a conflict, not a crash.
  async bindNumber(binding: NumberBinding): Promise<void> {
    const now = new Date();
    const pinEncrypted = encrypt(binding.pin, this.encryptionKey);
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
      const message = row ? toInbound(row) : null;
      if (row && message) leased.push({ instanceId: row.instanceId, message });
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
      .where(and(lt(whatsappCloudConversations.updatedAt, input.deleteConversationsIdleBefore), eq(whatsappCloudConversations.mode, "bot")));
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

  async setMode(instanceId: string, waId: string, mode: ConversationMode): Promise<Conversation | null> {
    const now = new Date();
    const rows = await this.db
      .update(whatsappCloudConversations)
      .set({ mode, updatedAt: now })
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
  const dt = a.message.timestamp.getTime() - b.message.timestamp.getTime();
  if (dt !== 0) return dt;
  const ai = BigInt(a.message.id);
  const bi = BigInt(b.message.id);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

function toInbound(row: { id: string; wamid: string; waTimestamp: Date; payload: unknown }): InboundMessage | null {
  if (!isRecord(row.payload) || typeof row.payload.from !== "string" || !isRecord(row.payload.message)) return null;
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
    updatedAt: row.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

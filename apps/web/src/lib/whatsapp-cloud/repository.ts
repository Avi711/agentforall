import "server-only";
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  WHATSAPP_CLOUD_INBOX_CHANNEL,
  WHATSAPP_CLOUD_OWNER_ECHO_KIND,
  WHATSAPP_CLOUD_PARTNER_REMOVED_KIND,
  instances,
  whatsappCloudConversations,
  whatsappCloudInbox,
  whatsappCloudNumbers,
  type Database,
} from "@agent-forall/db";
import { getDb } from "../db";

export interface InboundRow {
  kind: "message" | typeof WHATSAPP_CLOUD_OWNER_ECHO_KIND | typeof WHATSAPP_CLOUD_PARTNER_REMOVED_KIND;
  wamid: string;
  instanceId: string;
  // The customer; null for a row about the whole number.
  waId: string | null;
  profileName: string | null;
  waTimestamp: Date;
  receivedAt: Date;
  payload: Record<string, unknown>;
}

export interface WhatsappCloudIngressStore {
  findInstanceIdByPhoneNumberId(phoneNumberId: string): Promise<string | null>;
  findInstanceIdsByWabaId(wabaId: string): Promise<string[]>;
  enqueue(rows: InboundRow[]): Promise<number>;
}

export class WhatsappCloudRepository implements WhatsappCloudIngressStore {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  // A released number keeps its row (for the PIN) but routes nowhere; so does one whose bot is being destroyed.
  async findInstanceIdByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const rows = await this.db
      .select({ instanceId: whatsappCloudNumbers.instanceId })
      .from(whatsappCloudNumbers)
      .innerJoin(instances, eq(instances.id, whatsappCloudNumbers.instanceId))
      .where(
        and(
          eq(whatsappCloudNumbers.phoneNumberId, phoneNumberId),
          isNotNull(whatsappCloudNumbers.instanceId),
          notInArray(instances.status, ["destroying", "destroyed"]),
        ),
      )
      .limit(1);
    return rows[0]?.instanceId ?? null;
  }

  // Every live bot on the business account: a removal from inside the app covers all of its numbers.
  async findInstanceIdsByWabaId(wabaId: string): Promise<string[]> {
    const rows = await this.db
      .select({ instanceId: whatsappCloudNumbers.instanceId })
      .from(whatsappCloudNumbers)
      .innerJoin(instances, eq(instances.id, whatsappCloudNumbers.instanceId))
      .where(
        and(
          eq(whatsappCloudNumbers.wabaId, wabaId),
          isNotNull(whatsappCloudNumbers.instanceId),
          notInArray(instances.status, ["destroying", "destroyed"]),
        ),
      );
    return rows.flatMap((row) => (row.instanceId ? [row.instanceId] : []));
  }

  // One transaction per webhook: a redelivered batch inserts nothing and touches nothing twice.
  async enqueue(rows: InboundRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(whatsappCloudInbox)
        .values(
          rows.map((row) => ({
            wamid: row.wamid,
            instanceId: row.instanceId,
            waTimestamp: row.waTimestamp,
            payload: row.payload,
          })),
        )
        .onConflictDoNothing({ target: whatsappCloudInbox.wamid })
        .returning({ wamid: whatsappCloudInbox.wamid });
      const fresh = new Set(inserted.map((r) => r.wamid));
      // One wake-up per bot per webhook; the orchestrator that holds the bot's plugin acts on it, the rest ignore it.
      for (const instanceId of new Set(rows.filter((r) => fresh.has(r.wamid)).map((r) => r.instanceId))) {
        await tx.execute(sql`select pg_notify(${WHATSAPP_CLOUD_INBOX_CHANNEL}, ${instanceId})`);
      }
      // One lock order for every writer of these rows (the orchestrator sorts the same way), so no two wait on each other.
      for (const row of [...rows].sort(byWaId)) {
        // Who answers is the orchestrator's to record; the ledger only tracks what the customer sent.
        if (!fresh.has(row.wamid) || row.kind !== "message" || row.waId === null) continue;
        await tx
          .insert(whatsappCloudConversations)
          .values({
            instanceId: row.instanceId,
            waId: row.waId,
            profileName: row.profileName,
            lastInboundAt: row.receivedAt,
            updatedAt: row.receivedAt,
          })
          .onConflictDoUpdate({
            target: [whatsappCloudConversations.instanceId, whatsappCloudConversations.waId],
            set: {
              profileName: sql`coalesce(excluded.profile_name, ${whatsappCloudConversations.profileName})`,
              lastInboundAt: sql`greatest(${whatsappCloudConversations.lastInboundAt}, excluded.last_inbound_at)`,
              updatedAt: sql`greatest(${whatsappCloudConversations.updatedAt}, excluded.updated_at)`,
            },
          });
      }
      return inserted.length;
    });
  }
}

function byWaId(a: InboundRow, b: InboundRow): number {
  const left = a.waId ?? "";
  const right = b.waId ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

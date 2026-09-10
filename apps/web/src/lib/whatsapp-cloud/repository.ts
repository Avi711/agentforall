import "server-only";
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  WHATSAPP_CLOUD_INBOX_CHANNEL,
  instances,
  whatsappCloudConversations,
  whatsappCloudInbox,
  whatsappCloudNumbers,
  type Database,
} from "@agent-forall/db";
import { getDb } from "../db";

export interface InboundRow {
  wamid: string;
  instanceId: string;
  waId: string;
  profileName: string | null;
  waTimestamp: Date;
  receivedAt: Date;
  payload: Record<string, unknown>;
}

export interface WhatsappCloudIngressStore {
  findInstanceIdByPhoneNumberId(phoneNumberId: string): Promise<string | null>;
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
      for (const row of rows) {
        if (!fresh.has(row.wamid)) continue;
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

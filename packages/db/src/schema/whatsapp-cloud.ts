import {
  pgTable,
  bigserial,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { instances } from "./instances.js";

export const WHATSAPP_CLOUD_CONVERSATION_MODES = ["bot", "human"] as const;
export const WHATSAPP_CLOUD_SEND_KINDS = ["reply", "owner"] as const;
// pg NOTIFY channel the ingress raises on insert; the payload is the instance id.
export const WHATSAPP_CLOUD_INBOX_CHANNEL = "whatsapp_cloud_inbox";

// Webhook's number-to-bot map; the row outlives a disconnect because Meta keeps the number's two-step PIN.
export const whatsappCloudNumbers = pgTable("whatsapp_cloud_numbers", {
  phoneNumberId: varchar("phone_number_id", { length: 64 }).primaryKey(),
  instanceId: uuid("instance_id")
    .unique()
    .references(() => instances.id, { onDelete: "set null" }),
  wabaId: varchar("waba_id", { length: 64 }).notNull(),
  pinEncrypted: text("pin_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Inbound queue. A row outlives its ack (payload cleared) so a late Meta redelivery stays a no-op.
export const whatsappCloudInbox = pgTable(
  "whatsapp_cloud_inbox",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    wamid: varchar("wamid", { length: 255 }).notNull().unique(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    waTimestamp: timestamp("wa_timestamp", { withTimezone: true }).notNull(),
    payload: jsonb("payload"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
  },
  (t) => [
    // Only unfinished rows: the hot set stays tiny however many acked markers the table keeps.
    index("idx_whatsapp_cloud_inbox_pending")
      .on(t.instanceId, t.waTimestamp, t.id)
      .where(sql`${t.ackedAt} is null and ${t.droppedAt} is null`),
    // The sweeper deletes by age; without these it would scan the 8-day history every minute.
    index("idx_whatsapp_cloud_inbox_acked").on(t.ackedAt).where(sql`${t.ackedAt} is not null`),
    index("idx_whatsapp_cloud_inbox_dropped").on(t.droppedAt).where(sql`${t.droppedAt} is not null`),
  ],
);

export const whatsappCloudConversations = pgTable(
  "whatsapp_cloud_conversations",
  {
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    waId: varchar("wa_id", { length: 32 }).notNull(),
    profileName: varchar("profile_name", { length: 255 }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    mode: varchar("mode", { length: 8, enum: WHATSAPP_CLOUD_CONVERSATION_MODES })
      .notNull()
      .default("bot"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.waId] }), index("idx_whatsapp_cloud_conversations_updated").on(t.updatedAt)],
);

export const whatsappCloudSends = pgTable(
  "whatsapp_cloud_sends",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    waId: varchar("wa_id", { length: 32 }).notNull(),
    wamid: varchar("wamid", { length: 255 }),
    kind: varchar("kind", { length: 16, enum: WHATSAPP_CLOUD_SEND_KINDS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_whatsapp_cloud_sends_instance_created").on(t.instanceId, t.createdAt.desc()),
    index("idx_whatsapp_cloud_sends_created").on(t.createdAt),
  ],
);

import {
  pgTable,
  bigserial,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { instances } from "./instances.js";

// Append-only audit log driving resumable provisioning. Event types use dotted
// strings (provision.*, pair.*, session.*) — no enum, so adding new types is cheap.
export const instanceEvents = pgTable(
  "instance_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    actor: varchar("actor", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_instance_events_instance_id_created_at").on(
      t.instanceId,
      t.createdAt.desc(),
    ),
    index("idx_instance_events_event_type").on(t.eventType),
  ],
);

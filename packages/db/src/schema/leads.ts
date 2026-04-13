import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";

export const PLATFORMS = ["whatsapp", "telegram", "both"] as const;

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    platform: varchar("platform", { length: 20, enum: PLATFORMS }).notNull(),
    interest: text("interest"),
    source: varchar("source", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_leads_email").on(table.email),
    index("idx_leads_created_at").on(table.createdAt),
  ],
);

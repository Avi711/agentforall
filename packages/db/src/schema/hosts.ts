import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const HOST_STATUSES = ["active", "draining"] as const;

export const hosts = pgTable("hosts", {
  id: text("id").primaryKey(),
  address: text("address"),
  memoryMb: integer("memory_mb"),
  status: varchar("status", { length: 16, enum: HOST_STATUSES }).notNull().default("active"),
  lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

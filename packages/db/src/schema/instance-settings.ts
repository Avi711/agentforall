import { pgTable, uuid, jsonb, varchar, timestamp } from "drizzle-orm/pg-core";
import { instances } from "./instances.js";

// The two ciphertext blobs, kept apart from the fleet row the loops read.
export const instanceSettings = pgTable("instance_settings", {
  instanceId: uuid("instance_id")
    .primaryKey()
    .references(() => instances.id, { onDelete: "cascade" }),
  config: jsonb("config").notNull(),
  gatewayToken: varchar("gateway_token", { length: 256 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

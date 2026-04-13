import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const INSTANCE_STATUSES = [
  "provisioning",
  "running",
  "degraded",
  "unhealthy",
  "stopped",
  "destroying",
  "destroyed",
  "error",
] as const;

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    status: varchar("status", { length: 32, enum: INSTANCE_STATUSES })
      .notNull()
      .default("provisioning"),
    config: jsonb("config").notNull(),
    containerId: varchar("container_id", { length: 128 }),
    containerName: varchar("container_name", { length: 128 }).notNull(),
    gatewayPort: integer("gateway_port").notNull(),
    gatewayToken: varchar("gateway_token", { length: 256 }).notNull(),
    healthFailures: integer("health_failures").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_instances_gateway_port_active")
      .on(table.gatewayPort)
      .where(sql`${table.status} NOT IN ('destroyed', 'error')`),
    index("idx_instances_user_id").on(table.userId),
    index("idx_instances_status").on(table.status),
  ],
);

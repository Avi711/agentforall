import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  text,
  customType,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";

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

export const PAIRING_STATUSES = [
  "none",
  "awaiting_qr",
  "awaiting_code",
  "paired",
  "expired",
  "failed",
] as const;

export const BACKUP_IMPORT_STATUSES = [
  "none",
  "pending",
  "restored",
] as const;

export const AGENT_RUNTIME_KINDS = ["openclaw", "hermes"] as const;

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hostId: text("host_id").notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    runtimeKind: varchar("runtime_kind", {
      length: 32,
      enum: AGENT_RUNTIME_KINDS,
    })
      .notNull()
      .default("openclaw"),
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

    pairingStatus: varchar("pairing_status", {
      length: 32,
      enum: PAIRING_STATUSES,
    })
      .notNull()
      .default("none"),
    whatsappAccountId: varchar("whatsapp_account_id", { length: 64 }),
    whatsappCreds: bytea("whatsapp_creds"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    backupImportStatus: varchar("backup_import_status", {
      length: 32,
      enum: BACKUP_IMPORT_STATUSES,
    })
      .notNull()
      .default("none"),
    backupImportObjectName: text("backup_import_object_name"),
    backupImportContentLength: integer("backup_import_content_length"),
    backupImportContentType: varchar("backup_import_content_type", {
      length: 128,
    }),

    litellmKeyAlias: varchar("litellm_key_alias", { length: 128 }),
    litellmKeyHash: varchar("litellm_key_hash", { length: 128 }),
    litellmBudgetCents: integer("litellm_budget_cents"),
    litellmBudgetDuration: varchar("litellm_budget_duration", { length: 32 }),

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
      .on(table.hostId, table.gatewayPort)
      .where(sql`${table.status} NOT IN ('destroyed', 'error')`),
    index("idx_instances_user_id").on(table.userId),
    index("idx_instances_host_id").on(table.hostId),
    index("idx_instances_host_status").on(table.hostId, table.status),
    index("idx_instances_status").on(table.status),
    index("idx_instances_pairing_status").on(table.pairingStatus),
  ],
);

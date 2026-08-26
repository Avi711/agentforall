import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { instances } from "./instances.js";

export const INTEGRATION_PROVIDERS = ["composio", "mock"] as const;

// One provider session per bot; the row is what lets destroy revoke every connection.
export const integrationSessions = pgTable(
  "integration_sessions",
  {
    instanceId: uuid("instance_id")
      .primaryKey()
      .references(() => instances.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32, enum: INTEGRATION_PROVIDERS }).notNull(),
    providerSessionId: varchar("provider_session_id", { length: 128 }).notNull(),
    // Encrypted envelope: with the provider key this URL is a capability, not just an address.
    upstreamMcpUrl: text("upstream_mcp_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_integration_sessions_provider_session").on(t.provider, t.providerSessionId),
  ],
);

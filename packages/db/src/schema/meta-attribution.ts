import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

// The user's latest browser, so conversions sent from the server (payment webhooks among them) still match the ad click.
export const metaAttribution = pgTable("meta_attribution", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  fbp: text("fbp"),
  fbc: text("fbc"),
  clientIp: text("client_ip"),
  userAgent: text("user_agent"),
  country: text("country"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

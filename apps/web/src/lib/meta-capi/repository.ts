import "server-only";
import { eq, sql } from "drizzle-orm";
import { metaAttribution, user, type Database } from "@agent-forall/db";
import { getDb } from "../db";
import type { BrowserIds } from "./browser";

export interface MetaIdentity {
  email: string;
  name: string | null;
  browser: BrowserIds;
}

export class MetaAttributionRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  // A sign-in from a browser without Meta cookies keeps the ones the sign-up brought.
  async remember(userId: string, ids: BrowserIds): Promise<void> {
    await this.db
      .insert(metaAttribution)
      .values({ userId, ...ids, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: metaAttribution.userId,
        set: {
          fbp: sql`coalesce(excluded.fbp, ${metaAttribution.fbp})`,
          fbc: sql`coalesce(excluded.fbc, ${metaAttribution.fbc})`,
          clientIp: sql`coalesce(excluded.client_ip, ${metaAttribution.clientIp})`,
          userAgent: sql`coalesce(excluded.user_agent, ${metaAttribution.userAgent})`,
          country: sql`coalesce(excluded.country, ${metaAttribution.country})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async findIdentity(userId: string): Promise<MetaIdentity | null> {
    const rows = await this.db
      .select({
        email: user.email,
        name: user.name,
        fbp: metaAttribution.fbp,
        fbc: metaAttribution.fbc,
        clientIp: metaAttribution.clientIp,
        userAgent: metaAttribution.userAgent,
        country: metaAttribution.country,
      })
      .from(user)
      .leftJoin(metaAttribution, eq(metaAttribution.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      email: row.email,
      name: row.name,
      browser: { fbp: row.fbp, fbc: row.fbc, clientIp: row.clientIp, userAgent: row.userAgent, country: row.country },
    };
  }
}

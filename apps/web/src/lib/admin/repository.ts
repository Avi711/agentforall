import "server-only";
import { desc, eq, max } from "drizzle-orm";
import { session, user, type Database } from "@agent-forall/db";
import { getDb } from "../db";

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  betaAccess: boolean;
}

export class AdminRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  // "Last active" = newest session touch; sessions expire, so it is a floor, not an exact last-seen.
  async listUsers(): Promise<AdminUserRow[]> {
    const lastSeen = this.db
      .select({
        userId: session.userId,
        lastActiveAt: max(session.updatedAt).as("last_active_at"),
      })
      .from(session)
      .groupBy(session.userId)
      .as("last_seen");

    return this.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        betaAccess: user.betaAccess,
        lastActiveAt: lastSeen.lastActiveAt,
      })
      .from(user)
      .leftJoin(lastSeen, eq(lastSeen.userId, user.id))
      .orderBy(desc(user.createdAt));
  }
}

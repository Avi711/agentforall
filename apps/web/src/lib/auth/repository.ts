import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt, ne, notExists, or, sql } from "drizzle-orm";
import { account, rateLimit, user, type Database } from "@agent-forall/db";
import { getDb } from "../db";

export class AuthRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async claimAccount(userId: string): Promise<void> {
    await this.db
      .update(user)
      .set({ emailVerified: true, name: null, image: null, updatedAt: sql`now()` })
      .where(and(eq(user.id, userId), eq(user.emailVerified, false)));
  }

  async touchUser(userId: string): Promise<void> {
    await this.db.update(user).set({ updatedAt: sql`now()` }).where(eq(user.id, userId));
  }

  // Unconfirmed users without a social login never had a session; also covers a half-written sign-up.
  async deleteUnverifiedPasswordSignUps(lastTouchedBefore: Date, createdBefore: Date): Promise<number> {
    const deleted = await this.db
      .delete(user)
      .where(
        and(
          eq(user.emailVerified, false),
          or(lt(user.updatedAt, lastTouchedBefore), lt(user.createdAt, createdBefore)),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(account)
              .where(and(eq(account.userId, user.id), ne(account.providerId, "credential"))),
          ),
        ),
      )
      .returning({ id: user.id });
    return deleted.length;
  }

  // Atomic fixed-window counter in Better Auth's rate_limit table; returns the count including this hit.
  async countHit(key: string, windowMs: number, nowMs = Date.now()): Promise<number> {
    const [row] = await this.db
      .insert(rateLimit)
      .values({ id: randomUUID(), key, count: 1, lastRequest: nowMs })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`case when ${rateLimit.lastRequest} < ${nowMs - windowMs} then 1 else ${rateLimit.count} + 1 end`,
          lastRequest: sql`case when ${rateLimit.lastRequest} < ${nowMs - windowMs} then ${nowMs} else ${rateLimit.lastRequest} end`,
        },
      })
      .returning({ count: rateLimit.count });
    return row?.count ?? 1;
  }

  async deleteRateLimitRowsBefore(epochMs: number): Promise<number> {
    const deleted = await this.db.delete(rateLimit).where(lt(rateLimit.lastRequest, epochMs)).returning({ id: rateLimit.id });
    return deleted.length;
  }
}

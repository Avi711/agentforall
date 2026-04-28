import "server-only";
import { eq } from "drizzle-orm";
import { user, type Database } from "@agent-forall/db";
import { getDb } from "../db";

interface UserConsent {
  consentedAt: Date | null;
  consentVersion: number | null;
}

export class ConsentRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async findByUserId(userId: string): Promise<UserConsent | null> {
    const rows = await this.db
      .select({
        consentedAt: user.consentedWhatsappAt,
        consentVersion: user.consentVersion,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  // False = user vanished between session check and write — caller decides.
  async upsert(userId: string, version: number): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(user)
      .set({
        consentedWhatsappAt: now,
        consentVersion: version,
        updatedAt: now,
      })
      .where(eq(user.id, userId))
      .returning({ id: user.id });
    return updated.length > 0;
  }
}

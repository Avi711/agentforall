import "server-only";
import { eq, desc } from "drizzle-orm";
import { leads, type Database } from "@agent-forall/db";
import { getDb } from "../db";

interface NewLead {
  name: string;
  email: string;
  phone: string;
  platform: "whatsapp" | "telegram" | "both";
  interest: string | null;
  source: string;
}

export type Lead = typeof leads.$inferSelect;

export class LeadRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  async existsByEmail(email: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.email, email))
      .limit(1);
    return rows.length > 0;
  }

  async insert(lead: NewLead): Promise<void> {
    await this.db.insert(leads).values(lead);
  }

  async listNewestFirst(): Promise<Lead[]> {
    return this.db.select().from(leads).orderBy(desc(leads.createdAt));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(leads).where(eq(leads.id, id));
  }
}

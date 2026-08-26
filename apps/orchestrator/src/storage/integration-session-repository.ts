import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { integrationSessions } from "@agent-forall/db";
import { encrypt, decrypt } from "../services/crypto.js";
import type { IntegrationSession } from "../domain/integrations.js";

type Row = typeof integrationSessions.$inferSelect;
type DB = NodePgDatabase<Record<string, never>>;

export interface IntegrationSessionInsert {
  instanceId: string;
  provider: IntegrationSession["provider"];
  providerSessionId: string;
  upstreamMcpUrl: string;
}

export class IntegrationSessionRepository {
  constructor(
    private readonly db: DB,
    private readonly encryptionKey: Buffer,
  ) {}

  async findByInstanceId(instanceId: string): Promise<IntegrationSession | null> {
    const rows = await this.db
      .select()
      .from(integrationSessions)
      .where(eq(integrationSessions.instanceId, instanceId))
      .limit(1);
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async upsert(input: IntegrationSessionInsert): Promise<IntegrationSession> {
    const values = {
      instanceId: input.instanceId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      upstreamMcpUrl: encrypt(input.upstreamMcpUrl, this.encryptionKey),
      updatedAt: new Date(),
    };
    const rows = await this.db
      .insert(integrationSessions)
      .values(values)
      .onConflictDoUpdate({
        target: integrationSessions.instanceId,
        set: {
          provider: values.provider,
          providerSessionId: values.providerSessionId,
          upstreamMcpUrl: values.upstreamMcpUrl,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("integration session upsert returned no row");
    return this.toDomain(row);
  }

  async deleteByInstanceId(instanceId: string): Promise<void> {
    await this.db.delete(integrationSessions).where(eq(integrationSessions.instanceId, instanceId));
  }

  private toDomain(row: Row): IntegrationSession {
    return {
      instanceId: row.instanceId,
      provider: row.provider,
      providerSessionId: row.providerSessionId,
      upstreamMcpUrl: decrypt(row.upstreamMcpUrl, this.encryptionKey),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

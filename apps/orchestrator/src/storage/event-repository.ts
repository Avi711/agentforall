import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { instanceEvents } from "@agent-forall/db";
import { eq, desc } from "drizzle-orm";

type DB = NodePgDatabase<Record<string, never>>;

export interface InstanceEvent {
  id: bigint;
  instanceId: string;
  eventType: string;
  payload: Record<string, unknown>;
  actor: string | null;
  createdAt: Date;
}

export interface AppendOptions {
  actor?: string;
  payload?: Record<string, unknown>;
}

// Append-only — drives idempotent provisioning by recording which steps already ran.
export class EventRepository {
  constructor(private readonly db: DB) {}

  async append(
    instanceId: string,
    eventType: string,
    opts: AppendOptions = {},
  ): Promise<void> {
    await this.db.insert(instanceEvents).values({
      instanceId,
      eventType,
      payload: opts.payload ?? {},
      actor: opts.actor ?? "system",
    });
  }

  async recent(instanceId: string, limit = 50): Promise<InstanceEvent[]> {
    const rows = await this.db
      .select()
      .from(instanceEvents)
      .where(eq(instanceEvents.instanceId, instanceId))
      .orderBy(desc(instanceEvents.createdAt), desc(instanceEvents.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      instanceId: row.instanceId,
      eventType: row.eventType,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      actor: row.actor,
      createdAt: row.createdAt,
    }));
  }
}

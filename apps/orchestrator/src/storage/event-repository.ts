import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { instanceEvents } from "@agent-forall/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  PROVISIONING_EVENT_TYPES,
  provisioningStageOf,
  type ProvisioningStage,
} from "../domain/provisioning.js";

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

  async latestProvisioningStage(instanceId: string): Promise<ProvisioningStage | null> {
    const rows = await this.db
      .select({ eventType: instanceEvents.eventType })
      .from(instanceEvents)
      .where(
        and(
          eq(instanceEvents.instanceId, instanceId),
          inArray(instanceEvents.eventType, PROVISIONING_EVENT_TYPES),
        ),
      )
      .orderBy(desc(instanceEvents.createdAt), desc(instanceEvents.id))
      .limit(1);
    const eventType = rows[0]?.eventType;
    return eventType ? provisioningStageOf(eventType) : null;
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

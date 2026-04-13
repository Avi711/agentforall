import { eq, ne, inArray, sql, asc, gt, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { instances } from "@agent-forall/db";
import {
  encrypt,
  decrypt,
  encryptConfig,
  decryptConfig,
} from "../services/crypto.js";
import type {
  Instance,
  InstanceStatus,
  InstanceConfig,
} from "../domain/types.js";
import { InstanceConfigSchema } from "../domain/types.js";

type Row = typeof instances.$inferSelect;
type DB = NodePgDatabase<Record<string, never>>;

const HEALTH_STATUSES: InstanceStatus[] = ["running", "degraded", "unhealthy"];

export class InstanceRepository {
  constructor(
    private readonly db: DB,
    private readonly encryptionKey: Buffer,
  ) {}

  async insert(
    fields: Omit<Instance, "createdAt" | "updatedAt">,
  ): Promise<Instance> {
    const encrypted = encryptConfig(fields.config, this.encryptionKey);
    const encryptedToken = encrypt(fields.gatewayToken, this.encryptionKey);

    const rows = await this.db
      .insert(instances)
      .values({
        id: fields.id,
        userId: fields.userId,
        displayName: fields.displayName,
        status: fields.status,
        config: encrypted,
        containerId: fields.containerId,
        containerName: fields.containerName,
        gatewayPort: fields.gatewayPort,
        gatewayToken: encryptedToken,
        healthFailures: fields.healthFailures,
        errorMessage: fields.errorMessage,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("insert returned no rows");
    return this.toDomain(row);
  }

  async findById(id: string): Promise<Instance | null> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(eq(instances.id, id))
      .limit(1);
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async findByUserId(
    userId: string,
    cursor?: Date,
    limit = 50,
  ): Promise<Instance[]> {
    const conditions = [
      eq(instances.userId, userId),
      ne(instances.status, "destroyed"),
    ];
    if (cursor) {
      conditions.push(gt(instances.createdAt, cursor));
    }
    const rows = await this.db
      .select()
      .from(instances)
      .where(and(...conditions))
      .orderBy(asc(instances.createdAt), asc(instances.id))
      .limit(limit);
    return this.toDomainSafe(rows);
  }

  async countByUserId(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: instances.id })
      .from(instances)
      .where(
        and(
          eq(instances.userId, userId),
          ne(instances.status, "destroyed"),
          ne(instances.status, "error"),
        ),
      );
    return rows.length;
  }

  async findByStatuses(statuses: InstanceStatus[]): Promise<Instance[]> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(inArray(instances.status, statuses));
    return this.toDomainSafe(rows);
  }

  async getActiveGatewayPorts(): Promise<number[]> {
    const rows = await this.db
      .select({ gatewayPort: instances.gatewayPort })
      .from(instances)
      .where(
        and(ne(instances.status, "destroyed"), ne(instances.status, "error")),
      );
    return rows.map((r) => r.gatewayPort);
  }

  async updateStatus(
    id: string,
    status: InstanceStatus,
    options?: { expectedStatus?: InstanceStatus; errorMessage?: string },
  ): Promise<boolean> {
    const now = new Date();
    const conditions = [eq(instances.id, id)];
    if (options?.expectedStatus) {
      conditions.push(eq(instances.status, options.expectedStatus));
    }

    const result = await this.db
      .update(instances)
      .set({
        status,
        updatedAt: now,
        ...(status === "stopped" ? { stoppedAt: now } : {}),
        ...(status === "destroyed" ? { destroyedAt: now } : {}),
        ...(options?.errorMessage !== undefined
          ? { errorMessage: options.errorMessage }
          : {}),
      })
      .where(and(...conditions))
      .returning({ id: instances.id });

    return result.length > 0;
  }

  async updateHealth(
    id: string,
    failures: number,
    status: InstanceStatus,
  ): Promise<void> {
    await this.db
      .update(instances)
      .set({ healthFailures: failures, status, updatedAt: new Date() })
      .where(
        and(
          eq(instances.id, id),
          inArray(instances.status, HEALTH_STATUSES),
        ),
      );
  }

  async updateContainerId(id: string, containerId: string): Promise<void> {
    await this.db
      .update(instances)
      .set({ containerId, updatedAt: new Date() })
      .where(eq(instances.id, id));
  }

  async updateConfig(id: string, config: InstanceConfig): Promise<void> {
    const encrypted = encryptConfig(config, this.encryptionKey);
    await this.db
      .update(instances)
      .set({
        config: encrypted,
        displayName: config.displayName,
        updatedAt: new Date(),
      })
      .where(eq(instances.id, id));
  }

  async findStaleProvisioning(olderThanMs: number): Promise<Instance[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.status, "provisioning"),
          sql`${instances.createdAt} < ${cutoff}`,
        ),
      );
    return this.toDomainSafe(rows);
  }

  private toDomain(row: Row): Instance {
    const rawConfig = row.config as Record<string, unknown>;
    const parseResult = InstanceConfigSchema.safeParse(rawConfig);

    let config: InstanceConfig;
    if (parseResult.success) {
      config = decryptConfig(parseResult.data, this.encryptionKey);
    } else {
      config = {
        displayName: row.displayName,
        provider: {
          name: "anthropic",
          apiKey: "[corrupted]",
          model: "unknown",
        },
        channels: [],
        resources: { memoryMb: 512, cpuShares: 512 },
      };
    }

    let gatewayToken: string;
    try {
      gatewayToken = decrypt(row.gatewayToken, this.encryptionKey);
    } catch {
      gatewayToken = "[corrupted]";
    }

    return {
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      status: row.status as InstanceStatus,
      config,
      containerId: row.containerId,
      containerName: row.containerName,
      gatewayPort: row.gatewayPort,
      gatewayToken,
      healthFailures: row.healthFailures,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      stoppedAt: row.stoppedAt,
      destroyedAt: row.destroyedAt,
    };
  }

  private toDomainSafe(rows: Row[]): Instance[] {
    const results: Instance[] = [];
    for (const row of rows) {
      try {
        results.push(this.toDomain(row));
      } catch {
        // Skip corrupted rows — they'll be caught by reconciliation
      }
    }
    return results;
  }
}

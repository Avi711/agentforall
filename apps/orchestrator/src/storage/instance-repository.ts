import { eq, ne, inArray, or, sql, asc, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { instances } from "@agent-forall/db";
import {
  encrypt,
  decrypt,
  encryptBytes,
  decryptBytes,
  encryptConfig,
  decryptConfig,
} from "../services/crypto.js";
import type {
  Instance,
  InstanceStatus,
  InstanceConfig,
  PairingStatus,
  BackupImportRef,
} from "../domain/types.js";
import { InstanceConfigSchema } from "../domain/types.js";
import { CorruptedRowError, errorMessage } from "../domain/errors.js";

type Row = typeof instances.$inferSelect;
type DB = NodePgDatabase<Record<string, never>>;

const HEALTH_STATUSES: InstanceStatus[] = ["running", "degraded", "unhealthy"];

export interface PairingUpdate {
  pairingStatus?: PairingStatus;
  whatsappAccountId?: string | null;
  whatsappCreds?: Buffer | null;
  lastSeenAt?: Date | null;
}

export interface PairingUpdateOptions {
  /** Only apply the update if current row has this pairing_status. */
  expectedPairingStatus?: PairingStatus | PairingStatus[];
}

export interface BackupImportUpdate {
  status: "none" | "pending" | "restored";
  objectName?: string | null;
  contentLength?: number | null;
  contentType?: string | null;
}

export interface LiteLlmKeyUpdate {
  keyAlias: string;
  keyHash: string | null;
  budgetCents: number;
  budgetDuration: string;
}

type InsertInstanceFields = Omit<
  Instance,
  | "createdAt"
  | "updatedAt"
  | "hasWhatsappCreds"
  | "pairingStatus"
  | "whatsappAccountId"
  | "lastSeenAt"
  | "hostId"
  | "runtimeKind"
  | "backupImport"
  | "litellm"
> & {
  pairingStatus?: PairingStatus;
  runtimeKind?: Instance["runtimeKind"];
  backupImport?: BackupImportRef;
  litellm?: Instance["litellm"];
};

export class InstanceRepository {
  constructor(
    private readonly db: DB,
    private readonly encryptionKey: Buffer,
    private readonly hostId: string,
  ) {}

  // Caller never sets host_id — repo stamps its own. Prevents an upper-layer
  // bug from writing rows owned by another orchestrator.
  async insert(fields: InsertInstanceFields): Promise<Instance> {
    return this.insertWithDb(this.db, fields);
  }

  async insertIfUserActiveBelowLimit(
    fields: InsertInstanceFields,
    maxActive: number,
  ): Promise<Instance | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fields.userId}))`);
      const rows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(instances)
        .where(
          and(
            this.ownedByHost(),
            eq(instances.userId, fields.userId),
            this.isActive(),
          ),
        );
      if ((rows[0]?.count ?? 0) >= maxActive) return null;
      return this.insertWithDb(tx, fields);
    });
  }

  private async insertWithDb(
    db: Pick<DB, "insert">,
    fields: InsertInstanceFields,
  ): Promise<Instance> {
    const encrypted = encryptConfig(fields.config, this.encryptionKey);
    const encryptedToken = encrypt(fields.gatewayToken, this.encryptionKey);

    const rows = await db
      .insert(instances)
      .values({
        id: fields.id,
        userId: fields.userId,
        hostId: this.hostId,
        runtimeKind: fields.runtimeKind ?? "openclaw",
        displayName: fields.displayName,
        status: fields.status,
        config: encrypted,
        containerId: fields.containerId,
        containerName: fields.containerName,
        gatewayPort: fields.gatewayPort,
        gatewayToken: encryptedToken,
        healthFailures: fields.healthFailures,
        errorMessage: fields.errorMessage,
        pairingStatus: fields.pairingStatus ?? "none",
        backupImportStatus: fields.backupImport ? "pending" : "none",
        backupImportObjectName: fields.backupImport?.objectName ?? null,
        backupImportContentLength: fields.backupImport?.contentLength ?? null,
        backupImportContentType: fields.backupImport?.contentType ?? null,
        litellmKeyAlias: fields.litellm?.keyAlias ?? null,
        litellmKeyHash: fields.litellm?.keyHash ?? null,
        litellmBudgetCents: fields.litellm?.budgetCents ?? null,
        litellmBudgetDuration: fields.litellm?.budgetDuration ?? null,
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
      .where(and(eq(instances.id, id), this.ownedByHost()))
      .limit(1);
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async findByUserId(
    userId: string,
    cursor?: { createdAt: Date; id: string },
    limit = 50,
  ): Promise<Instance[]> {
    const conditions = [
      this.ownedByHost(),
      eq(instances.userId, userId),
      ne(instances.status, "destroyed"),
    ];
    if (cursor) {
      // (createdAt, id) > cursor — composite tiebreak for same-ms peers.
      conditions.push(
        or(
          sql`${instances.createdAt} > ${cursor.createdAt}`,
          and(
            eq(instances.createdAt, cursor.createdAt),
            sql`${instances.id} > ${cursor.id}`,
          ),
        )!,
      );
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
      .select({ count: sql<number>`count(*)::int` })
      .from(instances)
      .where(
        and(this.ownedByHost(), eq(instances.userId, userId), this.isActive()),
      );
    return rows[0]?.count ?? 0;
  }

  // Every live instance on this host, regardless of owner — admin reporting only.
  async findAllActive(): Promise<Instance[]> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(and(this.ownedByHost(), ne(instances.status, "destroyed")))
      .orderBy(asc(instances.createdAt), asc(instances.id));
    return this.toDomainSafe(rows);
  }

  async findByStatuses(statuses: InstanceStatus[]): Promise<Instance[]> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(and(this.ownedByHost(), inArray(instances.status, statuses)));
    return this.toDomainSafe(rows);
  }

  async findByPairingStatus(statuses: PairingStatus[]): Promise<Instance[]> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(
        and(this.ownedByHost(), inArray(instances.pairingStatus, statuses)),
      );
    return this.toDomainSafe(rows);
  }

  async getActiveGatewayPorts(): Promise<number[]> {
    const rows = await this.db
      .select({ gatewayPort: instances.gatewayPort })
      .from(instances)
      .where(and(this.ownedByHost(), this.isActive()));
    return rows.map((r) => r.gatewayPort);
  }

  // Defense-in-depth: every read filters by host so an orchestrator can never
  // see — let alone mutate — rows owned by a different host. Writes are scoped
  // by ID lookups, which themselves go through ownedByHost.
  private ownedByHost() {
    return eq(instances.hostId, this.hostId);
  }

  // Single definition of "active" — shared by quota count and port allocation.
  private isActive() {
    return and(
      ne(instances.status, "destroyed"),
      ne(instances.status, "error"),
    );
  }

  async updateStatus(
    id: string,
    status: InstanceStatus,
    options?: { expectedStatus?: InstanceStatus; errorMessage?: string },
  ): Promise<boolean> {
    const now = new Date();
    const conditions = [eq(instances.id, id), this.ownedByHost()];
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
    options: { markSeen?: boolean } = {},
  ): Promise<void> {
    const set: Record<string, unknown> = {
      healthFailures: failures,
      status,
      updatedAt: new Date(),
    };
    if (options.markSeen) set.lastSeenAt = new Date();
    await this.db
      .update(instances)
      .set(set)
      .where(
        and(
          eq(instances.id, id),
          this.ownedByHost(),
          inArray(instances.status, HEALTH_STATUSES),
        ),
      );
  }

  async updateContainerId(id: string, containerId: string): Promise<void> {
    await this.db
      .update(instances)
      .set({ containerId, updatedAt: new Date() })
      .where(and(eq(instances.id, id), this.ownedByHost()));
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
      .where(and(eq(instances.id, id), this.ownedByHost()));
  }

  async updateLiteLlmKey(id: string, patch: LiteLlmKeyUpdate): Promise<void> {
    await this.db
      .update(instances)
      .set({
        litellmKeyAlias: patch.keyAlias,
        litellmKeyHash: patch.keyHash,
        litellmBudgetCents: patch.budgetCents,
        litellmBudgetDuration: patch.budgetDuration,
        updatedAt: new Date(),
      })
      .where(and(eq(instances.id, id), this.ownedByHost()));
  }

  // Returns false when expectedPairingStatus guard rejected the write.
  async updatePairing(
    id: string,
    patch: PairingUpdate,
    options: PairingUpdateOptions = {},
  ): Promise<boolean> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.pairingStatus !== undefined) set.pairingStatus = patch.pairingStatus;
    if (patch.whatsappAccountId !== undefined)
      set.whatsappAccountId = patch.whatsappAccountId;
    if (patch.whatsappCreds !== undefined) {
      set.whatsappCreds =
        patch.whatsappCreds === null
          ? null
          : encryptBytes(patch.whatsappCreds, this.encryptionKey);
    }
    if (patch.lastSeenAt !== undefined) set.lastSeenAt = patch.lastSeenAt;

    const conditions = [eq(instances.id, id), this.ownedByHost()];
    if (options.expectedPairingStatus) {
      const expected = Array.isArray(options.expectedPairingStatus)
        ? options.expectedPairingStatus
        : [options.expectedPairingStatus];
      conditions.push(inArray(instances.pairingStatus, expected));
    }

    const result = await this.db
      .update(instances)
      .set(set)
      .where(and(...conditions))
      .returning({ id: instances.id });

    return result.length > 0;
  }

  async getDecryptedWhatsappCreds(id: string): Promise<Buffer | null> {
    const rows = await this.db
      .select({ creds: instances.whatsappCreds })
      .from(instances)
      .where(and(eq(instances.id, id), this.ownedByHost()))
      .limit(1);
    const row = rows[0];
    if (!row?.creds) return null;
    return decryptBytes(row.creds, this.encryptionKey);
  }

  async updateBackupImport(
    id: string,
    patch: BackupImportUpdate,
  ): Promise<void> {
    await this.db
      .update(instances)
      .set({
        backupImportStatus: patch.status,
        backupImportObjectName: patch.objectName ?? null,
        backupImportContentLength: patch.contentLength ?? null,
        backupImportContentType: patch.contentType ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(instances.id, id), this.ownedByHost()));
  }

  async findStaleProvisioning(olderThanMs: number): Promise<Instance[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(instances)
      .where(
        and(
          this.ownedByHost(),
          eq(instances.status, "provisioning"),
          sql`${instances.createdAt} < ${cutoff}`,
        ),
      );
    return this.toDomainSafe(rows);
  }

  async findStalePairings(olderThanMs: number): Promise<Instance[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(instances)
      .where(
        and(
          this.ownedByHost(),
          inArray(instances.pairingStatus, ["awaiting_qr", "awaiting_code"]),
          sql`${instances.updatedAt} < ${cutoff}`,
        ),
      );
    return this.toDomainSafe(rows);
  }

  private toDomain(row: Row): Instance {
    const parseResult = InstanceConfigSchema.safeParse(row.config);
    if (!parseResult.success) {
      throw new CorruptedRowError("instance", row.id, "config schema mismatch");
    }

    let config: InstanceConfig;
    let gatewayToken: string;
    try {
      config = decryptConfig(parseResult.data, this.encryptionKey);
      gatewayToken = decrypt(row.gatewayToken, this.encryptionKey);
    } catch (err) {
      throw new CorruptedRowError("instance", row.id, errorMessage(err));
    }

    return {
      id: row.id,
      userId: row.userId,
      hostId: row.hostId,
      runtimeKind: row.runtimeKind,
      displayName: row.displayName,
      status: row.status as InstanceStatus,
      config,
      containerId: row.containerId,
      containerName: row.containerName,
      gatewayPort: row.gatewayPort,
      gatewayToken,
      healthFailures: row.healthFailures,
      errorMessage: row.errorMessage,
      pairingStatus: row.pairingStatus as PairingStatus,
      whatsappAccountId: row.whatsappAccountId,
      hasWhatsappCreds: Boolean(row.whatsappCreds),
      lastSeenAt: row.lastSeenAt,
      backupImport: {
        status: row.backupImportStatus,
        objectName: row.backupImportObjectName,
        contentLength: row.backupImportContentLength,
        contentType: row.backupImportContentType,
      },
      litellm: {
        keyAlias: row.litellmKeyAlias,
        keyHash: row.litellmKeyHash,
        budgetCents: row.litellmBudgetCents,
        budgetDuration: row.litellmBudgetDuration,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      stoppedAt: row.stoppedAt,
      destroyedAt: row.destroyedAt,
    };
  }

  // Skip undecryptable rows in lists; reconciler handles them separately.
  private toDomainSafe(rows: Row[]): Instance[] {
    const results: Instance[] = [];
    for (const row of rows) {
      try {
        results.push(this.toDomain(row));
      } catch (err) {
        if (err instanceof CorruptedRowError) continue;
        throw err;
      }
    }
    return results;
  }
}

import { eq, ne, inArray, isNotNull, or, sql, asc, and } from "drizzle-orm";
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
  whatsappPaired?: boolean;
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

export interface MoveToInput {
  fromHostId: string;
  toHostId: string;
  gatewayPort: number;
  objectName: string;
  // A bot that was stopped before the move stays stopped on the target; `stopped_at` survives as the marker.
  keepStopped: boolean;
}

export interface MoveBackInput {
  toHostId: string;
  gatewayPort: number;
}

type InsertInstanceFields = Omit<
  Instance,
  | "createdAt"
  | "updatedAt"
  | "hasWhatsappCreds"
  | "pairingStatus"
  | "whatsappAccountId"
  | "lastSeenAt"
  | "runtimeKind"
  | "backupImport"
  | "litellm"
  | "movedFromHostId"
  | "moveObjectName"
  | "movedAt"
  | "moveImportedAt"
> & {
  pairingStatus?: PairingStatus;
  runtimeKind?: Instance["runtimeKind"];
  backupImport?: BackupImportRef;
  litellm?: Instance["litellm"];
};

export class InstanceRepository {
  private readonly managedHostIds: readonly string[];

  constructor(
    private readonly db: DB,
    private readonly encryptionKey: Buffer,
    managedHostIds: ReadonlySet<string>,
  ) {
    this.managedHostIds = [...managedHostIds];
    if (this.managedHostIds.length === 0) throw new Error("InstanceRepository needs at least one managed host");
  }

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
    this.assertManaged(fields.hostId);
    const encrypted = encryptConfig(fields.config, this.encryptionKey);
    const encryptedToken = encrypt(fields.gatewayToken, this.encryptionKey);

    const rows = await db
      .insert(instances)
      .values({
        id: fields.id,
        userId: fields.userId,
        hostId: fields.hostId,
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

  // Every live instance on this host, regardless of owner — admin reporting only.
  async findAllActive(): Promise<Instance[]> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(and(this.ownedByHost(), this.isActive()))
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

  async getActiveGatewayPorts(hostId: string): Promise<number[]> {
    const rows = await this.db
      .select({ gatewayPort: instances.gatewayPort })
      .from(instances)
      .where(and(this.ownedByHost(), eq(instances.hostId, hostId), this.isActive()));
    return rows.map((r) => r.gatewayPort);
  }

  // Every read and write filters by the managed set, so a second orchestrator sharing the DB (e.g. a dev machine) never touches these rows.
  private ownedByHost() {
    return inArray(instances.hostId, this.managedHostIds);
  }

  // Refuses a host outside the managed set so an upper-layer bug can never write a row another orchestrator owns.
  private assertManaged(hostId: string): void {
    if (!this.managedHostIds.includes(hostId)) {
      throw new Error(`host ${hostId} is not managed by this orchestrator`);
    }
  }

  // Single definition of "active" — shared by quota count and port allocation. An `error` row keeps
  // its port: recreate can revive it.
  private isActive() {
    return ne(instances.status, "destroyed");
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
    if (patch.whatsappPaired !== undefined) set.whatsappPaired = patch.whatsappPaired;
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

  // One CAS flip, `stopped` on the source to `provisioning` on the target; a (host, port) race raises 23505 for the caller to retry.
  async moveTo(id: string, input: MoveToInput): Promise<boolean> {
    this.assertManaged(input.toHostId);
    const now = new Date();
    const result = await this.db
      .update(instances)
      .set({
        hostId: input.toHostId,
        gatewayPort: input.gatewayPort,
        status: "provisioning",
        containerId: null,
        healthFailures: 0,
        errorMessage: null,
        movedFromHostId: input.fromHostId,
        moveObjectName: input.objectName,
        movedAt: now,
        moveImportedAt: null,
        ...(input.keepStopped ? {} : { stoppedAt: null }),
        updatedAt: now,
      })
      .where(
        and(
          eq(instances.id, id),
          this.ownedByHost(),
          eq(instances.hostId, input.fromHostId),
          eq(instances.status, "stopped"),
        ),
      )
      .returning({ id: instances.id });
    return result.length > 0;
  }

  // Rollback of a failed move: the `error` row returns to the host holding its volume, with no move columns for the sweeper to act on.
  async moveBack(id: string, input: MoveBackInput): Promise<boolean> {
    this.assertManaged(input.toHostId);
    const result = await this.db
      .update(instances)
      .set({
        hostId: input.toHostId,
        gatewayPort: input.gatewayPort,
        containerId: null,
        movedFromHostId: null,
        moveObjectName: null,
        movedAt: null,
        moveImportedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(instances.id, id),
          this.ownedByHost(),
          eq(instances.status, "error"),
          eq(instances.movedFromHostId, input.toHostId),
          isNotNull(instances.moveObjectName),
        ),
      )
      .returning({ id: instances.id });
    return result.length > 0;
  }

  async findMovedSourcesDue(olderThanMs: number): Promise<Instance[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(instances)
      .where(
        and(
          this.ownedByHost(),
          isNotNull(instances.movedFromHostId),
          sql`${instances.movedAt} < ${cutoff}`,
        ),
      );
    return this.toDomainSafe(rows);
  }

  async clearMove(id: string): Promise<void> {
    await this.db
      .update(instances)
      .set({ movedFromHostId: null, moveObjectName: null, movedAt: null, moveImportedAt: null, updatedAt: new Date() })
      .where(and(eq(instances.id, id), this.ownedByHost()));
  }

  async markMoveImported(id: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(instances)
      .set({ moveImportedAt: now, updatedAt: now })
      .where(and(eq(instances.id, id), this.ownedByHost()));
  }

  // Promotion and the end of the rollback window are one write: a set `move_object_name` means "never ran on the target".
  async completeMove(id: string, status: "running" | "stopped"): Promise<boolean> {
    const result = await this.db
      .update(instances)
      .set({ status, moveObjectName: null, moveImportedAt: null, updatedAt: new Date() })
      .where(and(eq(instances.id, id), this.ownedByHost(), eq(instances.status, "provisioning")))
      .returning({ id: instances.id });
    return result.length > 0;
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

  async findStalePairings(olderThanMs: number, hostIds: readonly string[]): Promise<Instance[]> {
    if (hostIds.length === 0) return [];
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(instances)
      .where(
        and(
          this.ownedByHost(),
          inArray(instances.hostId, [...hostIds]),
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
      hasWhatsappCreds: row.whatsappPaired,
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
      movedFromHostId: row.movedFromHostId,
      moveObjectName: row.moveObjectName,
      movedAt: row.movedAt,
      moveImportedAt: row.moveImportedAt,
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

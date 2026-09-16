import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { hosts } from "@agent-forall/db";
import type { HostStatus } from "../domain/types.js";

export interface HostRecord {
  id: string;
  address: string | null;
  memoryMb: number | null;
  status: HostStatus;
}

export class HostRepository {
  constructor(private readonly db: NodePgDatabase<Record<string, never>>) {}

  async ensure(id: string): Promise<void> {
    await this.db.insert(hosts).values({ id }).onConflictDoNothing();
  }

  async findAll(): Promise<HostRecord[]> {
    const rows = await this.db
      .select({ id: hosts.id, address: hosts.address, memoryMb: hosts.memoryMb, status: hosts.status })
      .from(hosts)
      .orderBy(hosts.id);
    return rows.map((row) => ({ id: row.id, address: row.address, memoryMb: row.memoryMb, status: row.status }));
  }

  async register(id: string, address: string, memoryMb?: number): Promise<void> {
    const capacity = memoryMb === undefined ? {} : { memoryMb };
    await this.db
      .insert(hosts)
      .values({ id, address, ...capacity, lastRegisteredAt: sql`now()` })
      .onConflictDoUpdate({ target: hosts.id, set: { address, ...capacity, lastRegisteredAt: sql`now()` } });
  }

  async setCapacity(id: string, memoryMb: number): Promise<void> {
    await this.db.update(hosts).set({ memoryMb }).where(eq(hosts.id, id));
  }
}

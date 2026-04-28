import "server-only";
import { Pool } from "pg";
import { createDbFromPool, type Database } from "@agent-forall/db";

declare global {
  // eslint-disable-next-line no-var
  var __agentforall_pgpool: Pool | undefined;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!globalThis.__agentforall_pgpool) {
    globalThis.__agentforall_pgpool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return globalThis.__agentforall_pgpool;
}

let cached: Database | undefined;

export function getDb(): Database {
  if (!cached) {
    cached = createDbFromPool(getPool());
  }
  return cached;
}

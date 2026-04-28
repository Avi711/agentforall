import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 20 });
  return drizzle(pool, { schema });
}

export function createDbFromPool(pool: Pool) {
  return drizzle(pool, { schema });
}

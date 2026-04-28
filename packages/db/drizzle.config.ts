import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: "../../apps/web/.env" });

const runtimeUrl = process.env.DATABASE_URL;
if (!runtimeUrl) {
  throw new Error("DATABASE_URL is required (set in apps/web/.env)");
}

// Supabase exposes two poolers on the same host: :6543 (transaction mode,
// incompatible with DDL) and :5432 (session mode, fine for migrations).
// Prefer an explicit MIGRATIONS_DATABASE_URL when provided; otherwise swap
// the port on a pooler host so drizzle-kit works without extra config.
const migrationsUrl =
  process.env.MIGRATIONS_DATABASE_URL ??
  runtimeUrl.replace(/(pooler\.supabase\.com):6543\b/, "$1:5432");

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationsUrl,
  },
});

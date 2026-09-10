// Postgres SQLSTATE 23505; drizzle surfaces the driver error either directly or as `cause`.
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && (err as { code: unknown }).code === "23505") return true;
  return "cause" in err && isUniqueViolation((err as { cause: unknown }).cause);
}

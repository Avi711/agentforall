// Drizzle appends the bound values (emails, IPs) after "params:"; logs keep only the part before them.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.split("\nparams:")[0] : "unknown";
}

// Reads `{ error: { message } }` from an API response body; null for anything else.
export function readApiErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

// Reads `{ error: { message } }` from an API response body; null for anything else.
export function readApiErrorMessage(body: unknown): string | null {
  return readErrorField(body, "message");
}

export function readApiErrorCode(body: unknown): string | null {
  return readErrorField(body, "code");
}

function readErrorField(body: unknown, field: "message" | "code"): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

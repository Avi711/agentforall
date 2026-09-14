import { randomInt } from "node:crypto";

// Meta's two-step verification PIN for a number we register for the first time.
export function freshPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

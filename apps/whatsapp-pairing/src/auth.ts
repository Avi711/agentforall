import { timingSafeEqual } from "node:crypto";

export function isAuthorized(
  header: string | string[] | undefined,
  expected: Buffer,
): boolean {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice(7), "utf8");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

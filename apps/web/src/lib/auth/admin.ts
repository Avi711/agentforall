import "server-only";
import { timingSafeEqual } from "node:crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD env var is required");
}

export function verifyAdminAuth(authorizationHeader: string | null): boolean {
  if (!ADMIN_PASSWORD) return false;
  const auth = authorizationHeader ?? "";
  const expected = `Bearer ${ADMIN_PASSWORD}`;
  const candidate = Buffer.from(auth, "utf8");
  const secret = Buffer.from(expected, "utf8");
  if (candidate.length !== secret.length) return false;
  return timingSafeEqual(candidate, secret);
}

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
  if (auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

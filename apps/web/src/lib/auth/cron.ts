import "server-only";
import { timingSafeEqual } from "node:crypto";

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; an unset secret disables every cron route.
export function isCronRequestAuthorized(authorizationHeader: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; every cron request is refused");
    return false;
  }
  if (!authorizationHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorizationHeader);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

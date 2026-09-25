import { DAY_MS } from "../dates";
import type { CreditGrant } from "../domain";
import { isGrantLive } from "./allocation";

const MIN_PACE_DAYS = 1;

// Top-ups are spent last, so the live trial or plan grant sets the pace.
export function runwayDays(grants: readonly CreditGrant[], available: number, now: Date): number | null {
  if (available <= 0) return null;
  const current = grants
    .filter((grant) => grant.kind !== "topup" && isGrantLive(grant, now))
    .reduce<CreditGrant | null>((latest, grant) => (latest && latest.grantedAt >= grant.grantedAt ? latest : grant), null);
  if (!current || current.usedCredits === 0) return null;
  const elapsedDays = (now.getTime() - current.grantedAt.getTime()) / DAY_MS;
  if (elapsedDays < MIN_PACE_DAYS) return null;
  const days = Math.floor(available / (current.usedCredits / elapsedDays));
  const daysToExpiry = current.expiresAt ? (current.expiresAt.getTime() - now.getTime()) / DAY_MS : Infinity;
  return days < daysToExpiry ? days : null;
}

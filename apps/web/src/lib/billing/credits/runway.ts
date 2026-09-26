import { DAY_MS } from "../dates";
import type { CreditGrant } from "../domain";
import { isGrantLive } from "./allocation";
import { periodEndOf } from "./period";

const MIN_PACE_DAYS = 1;

// Paced on the newest live trial or plan grant: it is spent only after older ones, so the rate can read low, never high.
export function runwayDays(grants: readonly CreditGrant[], available: number, now: Date): number | null {
  if (available <= 0) return null;
  const current = grants
    .filter((grant) => grant.kind !== "topup" && isGrantLive(grant, now))
    .reduce<CreditGrant | null>((latest, grant) => (latest && latest.grantedAt >= grant.grantedAt ? latest : grant), null);
  if (!current || current.usedCredits === 0) return null;
  const end = periodEndOf(current);
  if (!end || end.getTime() <= now.getTime()) return null;
  const elapsedDays = (now.getTime() - current.grantedAt.getTime()) / DAY_MS;
  if (elapsedDays < MIN_PACE_DAYS) return null;
  const days = Math.floor(available / (current.usedCredits / elapsedDays));
  return days < (end.getTime() - now.getTime()) / DAY_MS ? days : null;
}

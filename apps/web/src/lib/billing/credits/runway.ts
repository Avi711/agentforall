import { DAY_MS } from "../dates";
import type { CreditGrant } from "../domain";
import { isGrantLive } from "./allocation";
import { periodEndOf } from "./period";

const MIN_PACE_DAYS = 1;

export type CreditPace = { kind: "unknown" } | { kind: "lasts"; until: string } | { kind: "short"; days: number };

const UNKNOWN: CreditPace = { kind: "unknown" };

// Top-ups are spent last, so the live trial or plan grant sets the pace.
export function creditPace(grants: readonly CreditGrant[], available: number, now: Date): CreditPace {
  if (available <= 0) return UNKNOWN;
  const current = grants
    .filter((grant) => grant.kind !== "topup" && isGrantLive(grant, now))
    .reduce<CreditGrant | null>((latest, grant) => (latest && latest.grantedAt >= grant.grantedAt ? latest : grant), null);
  if (!current || current.usedCredits === 0) return UNKNOWN;
  const elapsedDays = (now.getTime() - current.grantedAt.getTime()) / DAY_MS;
  if (elapsedDays < MIN_PACE_DAYS) return UNKNOWN;
  const days = Math.floor(available / (current.usedCredits / elapsedDays));
  const end = periodEndOf(current);
  if (end === null) return UNKNOWN;
  return days < (end.getTime() - now.getTime()) / DAY_MS ? { kind: "short", days } : { kind: "lasts", until: end.toISOString() };
}

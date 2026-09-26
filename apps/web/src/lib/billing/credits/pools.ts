import type { CreditGrantKind } from "../domain";
import type { CreditGrantView } from "./service";

export interface CreditPool {
  key: string;
  kind: CreditGrantKind;
  earlier: boolean;
  available: number;
  credits: number;
  validUntil: string | null;
}

// A spent plan or trial still counts until its period ends, so it shows as empty rather than vanishing; a spent top-up does not.
export function isCurrentGrant(grant: CreditGrantView): boolean {
  return grant.live || (grant.periodEnd !== null && grant.inCurrentPeriod);
}

// Past its period end a plan grant stays live through the renewal grace, so it is valid until it expires.
function validUntilOf(grant: CreditGrantView): string | null {
  return grant.inCurrentPeriod ? grant.periodEnd : grant.expiresAt;
}

function untilOf(pool: Pick<CreditPool, "validUntil">): number {
  return pool.validUntil === null ? Number.POSITIVE_INFINITY : Date.parse(pool.validUntil);
}

// Grouped by the day credits stop being valid, since a renewal and its upgrade may not end on the same millisecond.
export function balancePools(grants: readonly CreditGrantView[]): CreditPool[] {
  const pools = new Map<string, CreditPool>();
  for (const grant of grants) {
    if (!isCurrentGrant(grant)) continue;
    const validUntil = validUntilOf(grant);
    const earlier = grant.kind === "plan" && !grant.inCurrentPeriod;
    const key = `${grant.kind}:${earlier ? "earlier" : "current"}:${validUntil?.slice(0, 10) ?? "never"}`;
    const pool = pools.get(key) ?? { key, kind: grant.kind, earlier, available: 0, credits: 0, validUntil };
    pool.available += Math.max(0, grant.credits - grant.usedCredits);
    pool.credits += grant.credits;
    if (validUntil !== null && pool.validUntil !== null && validUntil > pool.validUntil) pool.validUntil = validUntil;
    pools.set(key, pool);
  }
  return [...pools.values()].sort((a, b) => untilOf(a) - untilOf(b));
}

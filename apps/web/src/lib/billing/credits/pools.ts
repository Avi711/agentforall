import type { CreditGrantKind } from "../domain";
import type { CreditGrantView } from "./service";

export interface CreditPool {
  kind: CreditGrantKind;
  available: number;
  credits: number;
  validUntil: string | null;
}

// A spent grant still counts while its period runs, so a used-up plan shows as empty rather than vanishing.
export function isCurrentGrant(grant: CreditGrantView): boolean {
  return grant.live || grant.inCurrentPeriod;
}

// In spend order: the pool that ends first is used first, and top-ups last.
export function balancePools(grants: readonly CreditGrantView[]): CreditPool[] {
  const pools = new Map<CreditGrantKind, { available: number; credits: number; until: number }>();
  for (const grant of grants) {
    if (!isCurrentGrant(grant)) continue;
    const pool = pools.get(grant.kind) ?? { available: 0, credits: 0, until: Number.NEGATIVE_INFINITY };
    pool.available += Math.max(0, grant.credits - grant.usedCredits);
    pool.credits += grant.credits;
    pool.until = Math.max(pool.until, grant.periodEnd === null ? Number.POSITIVE_INFINITY : Date.parse(grant.periodEnd));
    pools.set(grant.kind, pool);
  }
  return [...pools]
    .sort(([, a], [, b]) => a.until - b.until)
    .map(([kind, pool]) => ({
      kind,
      available: pool.available,
      credits: pool.credits,
      validUntil: Number.isFinite(pool.until) ? new Date(pool.until).toISOString() : null,
    }));
}

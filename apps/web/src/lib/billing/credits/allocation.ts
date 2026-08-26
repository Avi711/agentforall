import type { CreditGrant } from "../domain";
import type { ConsumptionAttribution } from "../ports";

export interface AttributionResult {
  attributions: ConsumptionAttribution[];
  // Consumption no live grant could absorb — the ceiling was stale when it happened.
  unallocated: number;
}

export function isGrantLive(grant: CreditGrant, at: Date): boolean {
  return grant.usedCredits < grant.credits && (grant.expiresAt === null || grant.expiresAt.getTime() > at.getTime());
}

export function remainingCredits(grant: CreditGrant): number {
  return Math.max(0, grant.credits - grant.usedCredits);
}

// Soonest-to-expire first so perpetual top-up credits are the last thing spent.
export function consumptionOrder(grants: readonly CreditGrant[]): CreditGrant[] {
  return [...grants].sort((a, b) => {
    if (a.expiresAt === null && b.expiresAt !== null) return 1;
    if (a.expiresAt !== null && b.expiresAt === null) return -1;
    if (a.expiresAt !== null && b.expiresAt !== null && a.expiresAt.getTime() !== b.expiresAt.getTime()) {
      return a.expiresAt.getTime() - b.expiresAt.getTime();
    }
    return a.grantedAt.getTime() - b.grantedAt.getTime();
  });
}

// `asOf` is the previous sync, not now: spend made before a grant expired belongs to that grant.
export function attributeConsumption(grants: readonly CreditGrant[], consumed: number, asOf: Date): AttributionResult {
  if (!Number.isInteger(consumed) || consumed < 0) throw new RangeError(`consumed must be a non-negative integer, got ${consumed}`);
  const attributions: ConsumptionAttribution[] = [];
  let left = consumed;
  for (const grant of consumptionOrder(grants)) {
    if (left === 0) break;
    if (!isGrantLive(grant, asOf)) continue;
    const take = Math.min(left, remainingCredits(grant));
    attributions.push({ grantId: grant.id, credits: take });
    left -= take;
  }
  return { attributions, unallocated: left };
}

export function availableCredits(grants: readonly CreditGrant[], now: Date): number {
  return grants.filter((g) => isGrantLive(g, now)).reduce((sum, g) => sum + remainingCredits(g), 0);
}

// Size of the current allowance — what "20% left" is measured against.
export function currentAllowance(grants: readonly CreditGrant[], now: Date): number {
  return grants.filter((g) => isGrantLive(g, now)).reduce((sum, g) => sum + g.credits, 0);
}

import type { CreditGrant } from "../domain";
import { ACTIVE_GRACE_MS } from "../entitlement";

// Plan credits outlive their period by a grace for late renewal webhooks; users are shown the period end.
export function periodEndOf(grant: Pick<CreditGrant, "kind" | "expiresAt">): Date | null {
  if (grant.expiresAt === null) return null;
  return grant.kind === "plan" ? new Date(grant.expiresAt.getTime() - ACTIVE_GRACE_MS) : grant.expiresAt;
}

export function isInCurrentPeriod(grant: Pick<CreditGrant, "kind" | "expiresAt">, now: Date): boolean {
  const end = periodEndOf(grant);
  return end === null || end.getTime() > now.getTime();
}

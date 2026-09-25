import { ACTIVE_GRACE_MS } from "../entitlement";
import type { CreditGrantView } from "./service";

export interface UsagePeriod {
  key: string;
  kind: "plan" | "trial" | "topups";
  startsAt: string | null;
  endsAt: string | null;
  credits: number;
  used: number;
  current: boolean;
}

// A period's plan credits (renewal and any upgrade) expire together, a grace after the renewal; top-ups never expire, so they read as one running total.
export function usageHistory(grants: readonly CreditGrantView[]): UsagePeriod[] {
  const periods = new Map<string, UsagePeriod>();
  for (const grant of grants) {
    if (grant.kind !== "plan" || !grant.expiresAt) continue;
    const endsAt = new Date(Date.parse(grant.expiresAt) - ACTIVE_GRACE_MS).toISOString();
    const key = endsAt.slice(0, 10);
    const period = periods.get(key) ?? { key, kind: "plan", startsAt: grant.grantedAt, endsAt, credits: 0, used: 0, current: false };
    period.credits += grant.credits;
    period.used += grant.usedCredits;
    period.current ||= grant.live;
    if (period.startsAt === null || grant.grantedAt < period.startsAt) period.startsAt = grant.grantedAt;
    periods.set(key, period);
  }
  const history = [...periods.values()].sort((a, b) => (b.endsAt ?? "").localeCompare(a.endsAt ?? ""));

  const trial = grants.find((grant) => grant.kind === "trial");
  if (trial) {
    history.push({ key: "trial", kind: "trial", startsAt: trial.grantedAt, endsAt: trial.expiresAt, credits: trial.credits, used: trial.usedCredits, current: trial.live });
  }
  const topups = grants.filter((grant) => grant.kind === "topup");
  if (topups.length > 0) {
    history.push({
      key: "topups",
      kind: "topups",
      startsAt: null,
      endsAt: null,
      credits: topups.reduce((sum, grant) => sum + grant.credits, 0),
      used: topups.reduce((sum, grant) => sum + grant.usedCredits, 0),
      current: true,
    });
  }
  return history;
}

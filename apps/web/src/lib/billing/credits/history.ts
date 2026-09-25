import { isCurrentGrant } from "./pools";
import type { CreditGrantView } from "./service";

export interface PastPeriod {
  key: string;
  kind: "plan" | "trial";
  startsAt: string;
  endsAt: string;
  credits: number;
  used: number;
}

// A renewal and any upgrade in the same period share one period end, so they add up as one period.
export function pastPeriods(grants: readonly CreditGrantView[]): PastPeriod[] {
  const periods = new Map<string, PastPeriod>();
  const current = new Set<string>();
  for (const grant of grants) {
    if (grant.kind !== "plan" || grant.periodEnd === null) continue;
    const key = grant.periodEnd.slice(0, 10);
    if (isCurrentGrant(grant)) current.add(key);
    const period = periods.get(key) ?? { key, kind: "plan", startsAt: grant.grantedAt, endsAt: grant.periodEnd, credits: 0, used: 0 };
    period.credits += grant.credits;
    period.used += grant.usedCredits;
    if (grant.grantedAt < period.startsAt) period.startsAt = grant.grantedAt;
    periods.set(key, period);
  }
  const history = [...periods.values()].filter((period) => !current.has(period.key)).sort((a, b) => b.endsAt.localeCompare(a.endsAt));

  const trial = grants.find((grant) => grant.kind === "trial");
  if (trial?.periodEnd && !isCurrentGrant(trial)) {
    history.push({ key: "trial", kind: "trial", startsAt: trial.grantedAt, endsAt: trial.periodEnd, credits: trial.credits, used: trial.usedCredits });
  }
  return history;
}

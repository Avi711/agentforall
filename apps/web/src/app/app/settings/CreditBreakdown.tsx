import { balancePools, type CreditPool } from "@/lib/billing/credits/pools";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatDay } from "@/lib/billing/format";
import { AnimatedCredits } from "../AnimatedCredits";
import { BALANCE_NOTE, OUT_OF_CREDITS_LABEL, poolSource, poolSwatch, runwayLabel } from "../credits-copy";
import { UsageRow } from "./UsageRow";

function poolDetail(pool: CreditPool, pools: readonly CreditPool[], asOf: string): string {
  if (pool.validUntil !== null) return `בתוקף עד ${formatDay(pool.validUntil, asOf)}`;
  const spentFirst = pools.some((other) => other.validUntil !== null && other.available > 0);
  return spentFirst ? "לא פגים. משמשים רק אחרי שהקרדיטים האחרים נגמרים" : "לא פגים";
}

export function CreditBreakdown({ credits, renews }: { credits: CreditSummary; renews: boolean }) {
  const { balance, available, stale } = credits;
  if (balance.kind === "none") return null;
  const alert = balance.kind === "low" || balance.kind === "out";
  const pools = balancePools(credits.grants);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {balance.kind === "out" ? (
          <p className="text-2xl font-semibold text-terra-dark">{OUT_OF_CREDITS_LABEL[balance.reason]}</p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-5xl font-bold leading-none tracking-tight text-espresso tabular-nums">
              <AnimatedCredits value={available} />
            </span>
            <span className="text-base text-espresso-light">קרדיטים זמינים</span>
          </p>
        )}
        {credits.runwayDays !== null ? (
          <p className="text-base font-medium text-terra-dark">
            {runwayLabel(credits.runwayDays)}
            {renews ? ", לפני החידוש" : ""}.
          </p>
        ) : null}
      </div>
      {pools.length > 0 ? (
        <ul className="divide-y divide-sand-light/70 border-y border-sand-light/70">
          {pools.map((pool) => (
            <UsageRow
              key={pool.key}
              title={`קרדיטים ${poolSource(pool)}`}
              detail={poolDetail(pool, pools, credits.asOf)}
              used={pool.credits - pool.available}
              of={pool.credits}
              tone={poolSwatch(pool, alert)}
            />
          ))}
        </ul>
      ) : null}
      {stale ? <p className="text-xs text-espresso-light">הנתונים מהעדכון האחרון</p> : null}
      {alert ? (
        <p role="status" className="rounded-lg border border-terra/20 bg-terra-pale p-3 text-sm text-terra-dark">
          {BALANCE_NOTE[balance.kind]}
        </p>
      ) : null}
    </div>
  );
}

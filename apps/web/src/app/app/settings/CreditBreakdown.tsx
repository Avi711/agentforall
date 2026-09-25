import { balancePools, type CreditPool } from "@/lib/billing/credits/pools";
import type { CreditSummary } from "@/lib/billing/credits/service";
import type { CreditPace } from "@/lib/billing/credits/runway";
import { formatDay } from "@/lib/billing/format";
import { AnimatedCredits } from "../AnimatedCredits";
import { BALANCE_NOTE, OUT_OF_CREDITS_LABEL, POOL_SOURCE, poolSwatch, runwayLabel } from "../credits-copy";
import { UsageRow } from "./UsageRow";

function PaceLine({ pace, renews }: { pace: CreditPace; renews: boolean }) {
  switch (pace.kind) {
    case "unknown":
      return null;
    case "short":
      return (
        <p className="text-base font-medium text-terra-dark">
          {runwayLabel(pace.days)}
          {renews ? ", לפני החידוש" : ""}.
        </p>
      );
    case "lasts":
      return (
        <p className="text-base font-medium text-sage-dark">
          בקצב הנוכחי יש מספיק קרדיטים עד {renews ? "החידוש" : "סוף התקופה"} ב־{formatDay(pace.until)}.
        </p>
      );
  }
}

function poolDetail(pool: CreditPool): string {
  return pool.validUntil === null ? "לא פגים. משמשים רק אחרי שקרדיטי התוכנית נגמרים" : `בתוקף עד ${formatDay(pool.validUntil)}`;
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
        <PaceLine pace={credits.pace} renews={renews} />
      </div>
      {pools.length > 0 ? (
        <ul className="divide-y divide-sand-light/70 border-y border-sand-light/70">
          {pools.map((pool) => (
            <UsageRow
              key={pool.kind}
              title={`קרדיטים ${POOL_SOURCE[pool.kind]}`}
              detail={poolDetail(pool)}
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

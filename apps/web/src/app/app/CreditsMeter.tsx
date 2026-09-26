import type { ReactNode } from "react";
import { balancePools } from "@/lib/billing/credits/pools";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatCredits, formatDay } from "@/lib/billing/format";
import { AnimatedCredits } from "./AnimatedCredits";
import { BALANCE_NOTE, OUT_OF_CREDITS_LABEL, poolSource, poolSwatch, runwayLabel } from "./credits-copy";

const AMOUNT_SIZE = { lg: "text-5xl", sm: "text-2xl" } as const;

function percentOf(part: number, whole: number): string {
  return `${whole > 0 ? (part / whole) * 100 : 0}%`;
}

export function CreditsMeter({
  credits,
  size = "lg",
  action,
}: {
  credits: CreditSummary;
  size?: keyof typeof AMOUNT_SIZE;
  action?: ReactNode;
}) {
  const { balance, available, allowance, runwayDays, stale, asOf } = credits;
  if (balance.kind === "none") return null;
  const alert = balance.kind === "low" || balance.kind === "out";
  const pools = balancePools(credits.grants).filter((pool) => pool.available > 0);

  return (
    <div className="flex flex-col gap-3">
      {balance.kind === "out" ? (
        <p className="text-2xl font-semibold text-terra-dark">{OUT_OF_CREDITS_LABEL[balance.reason]}</p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          <span className={`${AMOUNT_SIZE[size]} font-bold leading-none tracking-tight text-espresso tabular-nums`}>
            <AnimatedCredits value={available} />
          </span>
          <span className="text-base text-espresso-light">קרדיטים זמינים</span>
        </p>
      )}
      {runwayDays !== null ? <p className="text-sm text-espresso-light">{runwayLabel(runwayDays)}</p> : null}
      {allowance > 0 ? (
        <div
          role="meter"
          aria-label="יתרת קרדיטים"
          aria-valuemin={0}
          aria-valuemax={allowance}
          aria-valuenow={available}
          aria-valuetext={`${formatCredits(available)} מתוך ${formatCredits(allowance)}`}
          className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-cream-dark"
        >
          {pools.map((pool) => (
            <div key={pool.key} className={`h-full rounded-full ${poolSwatch(pool, alert)}`} style={{ width: percentOf(pool.available, allowance) }} />
          ))}
        </div>
      ) : null}
      {pools.length > 0 ? (
        <ul className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-espresso-light">
          {pools.map((pool) => (
            <li key={pool.key} className="flex items-start gap-2">
              <span aria-hidden className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${poolSwatch(pool, alert)}`} />
              <span className="flex flex-col">
                <span>
                  <span className="font-semibold text-espresso tabular-nums">{formatCredits(pool.available)}</span> {poolSource(pool)}
                </span>
                <span>{pool.validUntil ? `בתוקף עד ${formatDay(pool.validUntil, asOf)}` : "לא פגים"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {stale ? <p className="text-xs text-espresso-light">הנתונים מהעדכון האחרון</p> : null}
      {alert ? (
        <p role="status" className="rounded-lg border border-terra/20 bg-terra-pale p-3 text-sm text-terra-dark">
          {BALANCE_NOTE[balance.kind]}
          {action ? <> {action}</> : null}
        </p>
      ) : null}
    </div>
  );
}

import type { ReactNode } from "react";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatCredits, formatDay } from "@/lib/billing/format";
import { AnimatedCredits } from "./AnimatedCredits";
import { OUT_OF_CREDITS_LABEL, runwayLabel } from "./credits-copy";

const AMOUNT_SIZE = { lg: "text-5xl", sm: "text-2xl" } as const;

const BALANCE_NOTE = {
  low: "הקרדיטים עומדים להיגמר. כשהם נגמרים הסוכן מפסיק לענות.",
  out: "הסוכן לא עונה עד שיהיו קרדיטים.",
} as const;

function percentOf(part: number, whole: number): string {
  return `${whole > 0 ? (part / whole) * 100 : 0}%`;
}

// The trial's own card already shows its end date, so only plan credits need their source spelled out.
function periodSource(credits: CreditSummary): { label: string; fromPlan: boolean } | null {
  // ISO timestamps sort as text.
  const planUntil = credits.grants.flatMap((g) => (g.kind === "plan" && g.live && g.expiresAt ? [g.expiresAt] : [])).sort()[0];
  if (planUntil) return { label: `מהתוכנית · בתוקף עד ${formatDay(planUntil)}`, fromPlan: true };
  if (credits.trial.kind === "active") return { label: `מתקופת הניסיון · בתוקף עד ${formatDay(credits.trial.expiresAt)}`, fromPlan: false };
  return null;
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
  const { balance, available, allowance, topupAvailable, runwayDays, stale } = credits;
  if (balance.kind === "none") return null;
  const periodAvailable = available - topupAvailable;
  const alert = balance.kind === "low" || balance.kind === "out";
  const period = periodSource(credits);

  return (
    <div className="flex flex-col gap-3">
      {balance.kind === "out" ? (
        <p className="text-2xl font-semibold text-terra-dark">{OUT_OF_CREDITS_LABEL[balance.reason]}</p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          <span className={`${AMOUNT_SIZE[size]} font-bold leading-none tracking-tight text-espresso tabular-nums`}>
            <AnimatedCredits value={available} showGain />
          </span>
          <span className="text-base text-espresso-light">מתוך {formatCredits(allowance)} קרדיטים</span>
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
          <div className={`h-full rounded-full ${alert ? "bg-terra" : "bg-sage"}`} style={{ width: percentOf(periodAvailable, allowance) }} />
          {topupAvailable > 0 ? (
            <div className="h-full rounded-full bg-sand" style={{ width: percentOf(topupAvailable, allowance) }} />
          ) : null}
        </div>
      ) : null}
      {topupAvailable > 0 || period?.fromPlan ? (
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-espresso-light">
          {period ? (
            <li className="flex items-center gap-2">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${alert ? "bg-terra" : "bg-sage"}`} />
              <span className="font-semibold text-espresso tabular-nums">{formatCredits(periodAvailable)}</span> {period.label}
            </li>
          ) : null}
          {topupAvailable > 0 ? (
            <li className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-sand" />
              <span className="font-semibold text-espresso tabular-nums">{formatCredits(topupAvailable)}</span> מטעינות · בלי תאריך תפוגה
            </li>
          ) : null}
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

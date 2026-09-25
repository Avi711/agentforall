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

interface LegendItem {
  amount: number;
  label: string;
  swatch: string;
}

// Two families: greens expire with the plan or the trial, honey is top-ups that never expire.
const SWATCH = {
  calm: { plan: "bg-sage", trial: "bg-sage-light" },
  alert: { plan: "bg-terra", trial: "bg-terra-light" },
} as const;

function legendOf(credits: CreditSummary, planEndsAt: string | null, alert: boolean): LegendItem[] {
  const hasPlan = credits.grants.some((g) => g.kind === "plan" && g.live);
  if (!hasPlan && credits.topupAvailable === 0) return [];
  const swatch = SWATCH[alert ? "alert" : "calm"];
  const trialLeft = credits.trial.kind === "active" ? credits.trial.remainingCredits : 0;
  const otherPeriodLeft = credits.available - credits.topupAvailable - trialLeft;
  const items: LegendItem[] = [];
  if (otherPeriodLeft > 0) {
    const label = !hasPlan ? "לתקופה הנוכחית" : planEndsAt ? `מהתוכנית · בתוקף עד ${formatDay(planEndsAt)}` : "מהתוכנית";
    items.push({ amount: otherPeriodLeft, label, swatch: swatch.plan });
  }
  if (credits.trial.kind === "active" && trialLeft > 0) {
    items.push({ amount: trialLeft, label: `מתקופת הניסיון · בתוקף עד ${formatDay(credits.trial.expiresAt)}`, swatch: swatch.trial });
  }
  if (credits.topupAvailable > 0) items.push({ amount: credits.topupAvailable, label: "מטעינות · בלי תאריך תפוגה", swatch: "bg-honey" });
  return items;
}

export function CreditsMeter({
  credits,
  planEndsAt = null,
  size = "lg",
  action,
}: {
  credits: CreditSummary;
  planEndsAt?: string | null;
  size?: keyof typeof AMOUNT_SIZE;
  action?: ReactNode;
}) {
  const { balance, available, allowance, topupAvailable, runwayDays, stale } = credits;
  if (balance.kind === "none") return null;
  const periodAvailable = available - topupAvailable;
  const alert = balance.kind === "low" || balance.kind === "out";
  const legend = legendOf(credits, planEndsAt, alert);
  const segments = legend.length > 0 ? legend : [{ amount: periodAvailable, swatch: SWATCH[alert ? "alert" : "calm"].plan }];

  return (
    <div className="flex flex-col gap-3">
      {balance.kind === "out" ? (
        <p className="text-2xl font-semibold text-terra-dark">{OUT_OF_CREDITS_LABEL[balance.reason]}</p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          <span className={`${AMOUNT_SIZE[size]} font-bold leading-none tracking-tight text-espresso tabular-nums`}>
            <AnimatedCredits value={available} />
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
          {segments.map((segment) => (
            <div key={segment.swatch} className={`h-full rounded-full ${segment.swatch}`} style={{ width: percentOf(segment.amount, allowance) }} />
          ))}
        </div>
      ) : null}
      {legend.length > 0 ? (
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-espresso-light">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${item.swatch}`} />
              <span className="font-semibold text-espresso tabular-nums">{formatCredits(item.amount)}</span> {item.label}
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

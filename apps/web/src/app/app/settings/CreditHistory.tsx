import type { CreditSummary } from "@/lib/billing/credits/service";
import { usageHistory, type UsagePeriod } from "@/lib/billing/credits/history";
import { formatCredits, formatDay } from "@/lib/billing/format";
import { SurfaceCard } from "../Marks";

function titleOf(period: UsagePeriod): { title: string; detail: string | null } {
  const range = period.startsAt && period.endsAt ? `${formatDay(period.startsAt)} – ${formatDay(period.endsAt)}` : null;
  switch (period.kind) {
    case "plan":
      return period.current ? { title: "התקופה הנוכחית", detail: range } : { title: range ?? "תקופה קודמת", detail: null };
    case "trial":
      return { title: "תקופת הניסיון", detail: range };
    case "topups":
      return { title: "טעינות", detail: "כל הטעינות עד היום · לא פגים" };
  }
}

function percentOf(part: number, whole: number): string {
  return `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%`;
}

export function CreditHistory({ credits }: { credits: CreditSummary }) {
  const history = usageHistory(credits.grants);
  if (!history.some((period) => period.kind !== "trial")) return null;

  return (
    <SurfaceCard className="flex flex-col gap-2 p-6 sm:p-8">
      <h2 className="font-display text-2xl text-espresso">שימוש בקרדיטים</h2>
      <ul className="divide-y divide-sand-light/70">
        {history.map((period) => {
          const { title, detail } = titleOf(period);
          return (
            <li key={period.key} className="flex flex-col gap-2 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="flex flex-col">
                  <span className="text-[15px] font-semibold text-espresso">{title}</span>
                  {detail ? <span className="text-[13px] text-espresso-light">{detail}</span> : null}
                </p>
                <p className="text-sm text-espresso-light tabular-nums">
                  נוצלו <span className="font-semibold text-espresso">{formatCredits(period.used)}</span> מתוך {formatCredits(period.credits)}
                </p>
              </div>
              <div
                role="meter"
                aria-label={`${title}: נוצלו ${formatCredits(period.used)} מתוך ${formatCredits(period.credits)}`}
                aria-valuemin={0}
                aria-valuemax={period.credits}
                aria-valuenow={period.used}
                className="h-1.5 overflow-hidden rounded-full bg-cream-dark"
              >
                <div
                  className={`h-full rounded-full ${period.kind === "topups" ? "bg-honey" : "bg-sage"}`}
                  style={{ width: percentOf(period.used, period.credits) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </SurfaceCard>
  );
}

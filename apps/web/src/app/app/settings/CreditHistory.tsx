"use client";

import { useState } from "react";
import { pastPeriods, type PastPeriod } from "@/lib/billing/credits/history";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatDay } from "@/lib/billing/format";
import { PageSection } from "./Section";
import { UsageRow } from "./UsageRow";

const RECENT_PERIODS = 3;

function PeriodRow({ period, asOf }: { period: PastPeriod; asOf: string }) {
  const range = `${formatDay(period.startsAt, asOf)} – ${formatDay(period.endsAt, asOf)}`;
  const trial = period.kind === "trial";
  return (
    <UsageRow
      title={trial ? "תקופת הניסיון" : range}
      detail={trial ? range : null}
      used={period.used}
      of={period.credits}
      tone={trial ? "bg-sage-light" : "bg-sage"}
    />
  );
}

export function CreditHistory({ credits }: { credits: CreditSummary }) {
  const [showAll, setShowAll] = useState(false);
  const periods = pastPeriods(credits.grants);
  if (periods.length === 0) return null;
  const hidden = showAll ? 0 : Math.max(0, periods.length - RECENT_PERIODS);

  return (
    <PageSection id="usage" title="תקופות קודמות">
      <ul className="divide-y divide-sand-light/70">
        {periods.slice(0, periods.length - hidden).map((period) => (
          <PeriodRow key={period.key} period={period} asOf={credits.asOf} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start py-1 text-sm font-medium text-espresso-light underline-offset-4 hover:text-espresso hover:underline"
        >
          הצגת כל התקופות ({hidden} נוספות)
        </button>
      ) : null}
    </PageSection>
  );
}

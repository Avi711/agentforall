import { PRIMARY_ACTION } from "@/components/pricing/styles";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { settingsSectionHref } from "@/lib/billing/urls";
import { PendingLink } from "./Pending";
import { TrialSummary, type ActiveTrial } from "./TrialSummary";

export function TrialBar({ trial, credits }: { trial: ActiveTrial; credits: CreditSummary }) {
  return (
    <section
      aria-label="תקופת ניסיון"
      className="mb-5 flex flex-col gap-4 rounded-3xl border border-terra/20 bg-terra-pale/60 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6"
    >
      <TrialSummary trial={trial} credits={credits} size="sm" />
      <PendingLink href={settingsSectionHref("plans")} className={`${PRIMARY_ACTION} sm:shrink-0`}>
        בחירת תוכנית
      </PendingLink>
    </section>
  );
}

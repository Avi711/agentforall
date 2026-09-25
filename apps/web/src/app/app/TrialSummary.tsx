import type { CreditSummary, TrialState } from "@/lib/billing/credits/service";
import { formatDay } from "@/lib/billing/format";
import { daysLeftLabel } from "./credits-copy";
import { CreditsMeter } from "./CreditsMeter";
import { StatusLabel } from "./Marks";

export type ActiveTrial = Extract<TrialState, { kind: "active" }>;

export function TrialSummary({ trial, credits, size }: { trial: ActiveTrial; credits: CreditSummary; size: "lg" | "sm" }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusLabel tone="good">ניסיון חינם · {daysLeftLabel(trial.daysLeft)}</StatusLabel>
        <span className="text-[13px] text-espresso-light">עד {formatDay(trial.expiresAt)}</span>
      </p>
      <CreditsMeter credits={credits} size={size} />
    </div>
  );
}

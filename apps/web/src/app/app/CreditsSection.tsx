import type { CreditSummary } from "@/lib/billing/credits/service";
import type { CreditsAction } from "@/lib/billing/service";
import { SETTINGS_PATH } from "@/lib/billing/urls";
import { ROW_ACTION_CLASS } from "./action-buttons";
import { CreditsActionLink } from "./credits-copy";
import { CreditsMeter } from "./CreditsMeter";
import { PendingLink } from "./Pending";

export function CreditsSection({ credits, action }: { credits: CreditSummary; action: CreditsAction }) {
  if (credits.balance.kind === "none") return null;
  const urgent = credits.balance.kind === "low" || credits.balance.kind === "out";

  return (
    <section aria-label="קרדיטים" className="mb-6 sm:mb-7">
      <CreditsMeter
        credits={credits}
        size="sm"
        aside={
          <div className="flex flex-wrap gap-2">
            <PendingLink href={SETTINGS_PATH} className={ROW_ACTION_CLASS.quiet}>
              פירוט
            </PendingLink>
            <CreditsActionLink action={action} className={urgent ? ROW_ACTION_CLASS.primary : ROW_ACTION_CLASS.quiet} />
          </div>
        }
      />
    </section>
  );
}

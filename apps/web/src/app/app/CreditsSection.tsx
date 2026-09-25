import type { CreditSummary } from "@/lib/billing/credits/service";
import type { CreditsAction, SubscriptionView } from "@/lib/billing/service";
import { CreditsActionLink } from "./credits-copy";
import { CreditsMeter } from "./CreditsMeter";
import { SECTION_LABEL } from "./Marks";

export function CreditsSection({
  credits,
  action,
  subscription,
}: {
  credits: CreditSummary;
  action: CreditsAction;
  subscription: SubscriptionView | null;
}) {
  if (credits.balance.kind === "none") return null;

  return (
    <section className="mb-6 border-t border-sand-light/70 pt-6 sm:mb-7 sm:pt-7">
      <p className={`${SECTION_LABEL} mb-3`}>יתרת קרדיטים</p>
      <CreditsMeter
        credits={credits}
        subscription={subscription}
        size="sm"
        action={<CreditsActionLink action={action} className="font-medium underline" />}
      />
    </section>
  );
}

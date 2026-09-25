import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatDate, formatDay } from "@/lib/billing/format";
import type { CreditsAction } from "@/lib/billing/service";
import { CreditsActionLink } from "./credits-copy";
import { CreditsMeter } from "./CreditsMeter";
import { SECTION_LABEL } from "./Marks";

export function CreditsSection({ credits, action }: { credits: CreditSummary; action: CreditsAction }) {
  if (credits.balance.kind === "none") return null;
  const expiry = nextExpiryLabel(credits);

  return (
    <section className="mb-6 border-t border-sand-light/70 pt-6 sm:mb-7 sm:pt-7">
      <p className={`${SECTION_LABEL} mb-3`}>יתרת קרדיטים</p>
      <CreditsMeter credits={credits} size="sm" action={<CreditsActionLink action={action} className="font-medium underline" />} />
      {expiry ? <p className="mt-2 text-xs text-espresso-light">{expiry}</p> : null}
    </section>
  );
}

function nextExpiryLabel(credits: CreditSummary): string {
  if (credits.trial.kind === "active") return `תקופת ניסיון עד ${formatDay(credits.trial.expiresAt)}`;
  // ISO timestamps sort as text.
  const soonest = credits.grants
    .flatMap((g) => (g.kind === "plan" && g.live && g.expiresAt ? [g.expiresAt] : []))
    .sort()[0];
  const until = formatDate(soonest ?? null);
  return until ? `קרדיטים של המנוי בתוקף עד ${until}` : "";
}

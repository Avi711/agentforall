import { PendingLink } from "./Pending";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatCredits, formatDay } from "@/lib/billing/format";
import { SECTION_LABEL } from "./Marks";

export function CreditsSection({ credits }: { credits: CreditSummary }) {
  // No ledger yet (bot from before billing, or access without credits): nothing meaningful to meter.
  if (credits.grants.length === 0) return null;
  const percent = credits.allowance > 0 ? Math.round((credits.available / credits.allowance) * 100) : 0;
  const empty = credits.available === 0;
  const expiry = nextExpiryLabel(credits);

  return (
    <section className="mb-6 sm:mb-7 border-t border-sand-light/70 pt-6 sm:pt-7">
      <p className={`${SECTION_LABEL} mb-2`}>יתרת קרדיטים</p>
      <p className="text-2xl font-medium tabular-nums leading-none">
        <span className={empty ? "text-terra-dark" : "text-espresso"}>{formatCredits(credits.available)}</span>
        <span className="text-sm text-espresso-light font-normal"> מתוך {formatCredits(credits.allowance)}</span>
      </p>
      <div
        className="mt-3 h-1.5 rounded-full bg-cream-dark overflow-hidden"
        dir="rtl"
        role="meter"
        aria-label="יתרת קרדיטים"
        aria-valuemin={0}
        aria-valuemax={credits.allowance}
        aria-valuenow={credits.available}
        aria-valuetext={`${formatCredits(credits.available)} מתוך ${formatCredits(credits.allowance)}`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${credits.lowBalance ? "bg-terra" : "bg-sage"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {expiry ? <p className="mt-2 text-xs text-espresso-light">{expiry}</p> : null}
      {credits.lowBalance ? (
        <p className="mt-3 text-sm text-terra-dark bg-terra-pale border border-terra/20 rounded-lg p-3">
          {empty ? "הקרדיטים נגמרו והסוכן לא עונה." : "הקרדיטים עומדים להיגמר."}{" "}
          <PendingLink href="/app/settings" className="underline font-medium">
            טעינת קרדיטים
          </PendingLink>
        </p>
      ) : null}
    </section>
  );
}

function nextExpiryLabel(credits: CreditSummary): string {
  if (credits.trial.kind === "active") return `תקופת ניסיון עד ${formatDay(credits.trial.expiresAt)}`;
  // ISO timestamps sort as text.
  const soonest = credits.grants
    .flatMap((g) => (g.kind === "plan" && g.live && g.expiresAt ? [g.expiresAt] : []))
    .sort()[0];
  return soonest ? `קרדיטים של המנוי בתוקף עד ${formatDay(soonest)}` : "";
}

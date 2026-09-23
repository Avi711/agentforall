import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatCredits, formatDay } from "@/lib/billing/format";
import type { CreditsAction } from "@/lib/billing/service";
import { CreditsActionLink, OUT_OF_CREDITS_LABEL } from "./credits-copy";
import { SECTION_LABEL } from "./Marks";

export function CreditsSection({ credits, action }: { credits: CreditSummary; action: CreditsAction }) {
  // Nothing granted and nothing metered yet.
  const { balance } = credits;
  if (balance.kind === "none") return null;
  const out = balance.kind === "out";
  const low = balance.kind === "low";
  const percent = credits.allowance > 0 ? Math.round((credits.available / credits.allowance) * 100) : 0;
  const expiry = nextExpiryLabel(credits);

  return (
    <section className="mb-6 sm:mb-7 border-t border-sand-light/70 pt-6 sm:pt-7">
      <p className={`${SECTION_LABEL} mb-2`}>יתרת קרדיטים</p>
      {balance.kind === "out" ? (
        <p className="text-2xl font-medium leading-none text-terra-dark">
          {OUT_OF_CREDITS_LABEL[balance.reason]}
        </p>
      ) : (
        <p className="text-2xl font-medium tabular-nums leading-none">
          <span className="text-espresso">{formatCredits(credits.available)}</span>
          <span className="text-sm text-espresso-light font-normal"> מתוך {formatCredits(credits.allowance)}</span>
        </p>
      )}
      <div
        className="mt-3 h-1.5 rounded-full bg-cream-dark overflow-hidden"
        dir="rtl"
        {...(out
          ? { "aria-hidden": true }
          : {
              role: "meter",
              "aria-label": "יתרת קרדיטים",
              "aria-valuemin": 0,
              "aria-valuemax": credits.allowance,
              "aria-valuenow": credits.available,
              "aria-valuetext": `${formatCredits(credits.available)} מתוך ${formatCredits(credits.allowance)}`,
            })}
      >
        <div
          className={`h-full rounded-full transition-[width] ${low || out ? "bg-terra" : "bg-sage"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {expiry ? <p className="mt-2 text-xs text-espresso-light">{expiry}</p> : null}
      {low ? (
        <p className="mt-3 text-sm text-terra-dark bg-terra-pale border border-terra/20 rounded-lg p-3">
          הקרדיטים עומדים להיגמר. <CreditsActionLink action={action} className="underline font-medium" />
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

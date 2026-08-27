import Link from "next/link";
import type { CreditSummary } from "@/lib/billing/credits/service";
import { formatCredits, formatDay } from "@/lib/billing/format";
import { estimatedMessages } from "@/lib/billing/pricing";
import { SECTION_LABEL } from "./Marks";

export function CreditsSection({ credits }: { credits: CreditSummary }) {
  // No ledger yet (bot from before billing, or access without credits): nothing meaningful to meter.
  if (credits.grants.length === 0) return null;
  const percent = credits.allowance > 0 ? Math.round((credits.available / credits.allowance) * 100) : 0;
  const messages = estimatedMessages(credits.available);

  return (
    <section className="mb-6 sm:mb-7 border-t border-sand-light/70 pt-6 sm:pt-7">
      <div className="flex items-end justify-between gap-4 mb-3">
        <div>
          <p className={`${SECTION_LABEL} mb-1`}>קרדיטים זמינים</p>
          <p className="text-2xl font-medium text-espresso tabular-nums" dir="ltr">
            {formatCredits(credits.available)}
            <span className="text-sm text-espresso-light font-normal"> מתוך {formatCredits(credits.allowance)}</span>
          </p>
        </div>
        <p className="text-xs text-espresso-light text-end">≈ {formatCredits(messages)} הודעות</p>
      </div>
      <div
        className="h-2 rounded-full bg-cream-dark overflow-hidden"
        dir="rtl"
        role="meter"
        aria-label="קרדיטים זמינים"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${formatCredits(credits.available)} מתוך ${formatCredits(credits.allowance)}`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${credits.lowBalance ? "bg-amber-500" : "bg-terra"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 text-xs text-espresso-light">
        <span>{nextExpiryLabel(credits)}</span>
        <span dir="ltr">{percent}%</span>
      </div>
      {credits.lowBalance ? (
        <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
          הקרדיטים עומדים להיגמר.{" "}
          <Link href="/app/settings" className="underline font-medium">
            טעינת קרדיטים
          </Link>
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

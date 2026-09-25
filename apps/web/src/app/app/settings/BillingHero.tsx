import type { ReactNode } from "react";
import { PRIMARY_ACTION } from "@/components/pricing/styles";
import type { EntitlementReason } from "@/lib/billing/entitlement";
import { formatIls, intervalAdjective, planLabel } from "@/lib/billing/format";
import type { Plan } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import { CreditsMeter } from "../CreditsMeter";
import { StatusLabel, SurfaceCard, type Tone } from "../Marks";
import { TrialSummary } from "../TrialSummary";

const TRIAL_NOTE = "כשהניסיון נגמר הסוכן מפסיק לענות. בחרו תוכנית והוא ימשיך בלי הפסקה, עם כל ההגדרות והחיבורים שלו.";
const OPEN_ACCESS_NOTE = "הגישה שלכם פתוחה כרגע ללא מנוי. אפשר להצטרף כבר עכשיו כדי לשמור על הסוכן גם בהמשך.";
const OPEN_ACCESS_REASONS: ReadonlySet<EntitlementReason> = new Set(["beta_access", "enforcement_disabled"]);

function planlessLabel(status: BillingStatus): { tone: Tone; text: string } {
  switch (status.reason) {
    case "beta_access":
      return { tone: "good", text: "גישת בטא" };
    case "enforcement_disabled":
      return { tone: "good", text: "גישה פתוחה" };
    case "trial_available":
      return { tone: "good", text: "ניסיון חינם זמין" };
    default:
      return status.credits.trial.kind === "used"
        ? { tone: "muted", text: "תקופת הניסיון הסתיימה" }
        : { tone: "muted", text: "ללא מנוי" };
  }
}

export function ChoosePlanHero({ status, canChoosePlan }: { status: BillingStatus; canChoosePlan: boolean }) {
  const { credits } = status;
  const trial = credits.trial.kind === "active" ? credits.trial : null;
  const label = planlessLabel(status);
  const hasCredits = credits.balance.kind === "ok" || credits.balance.kind === "low";
  const note = trial ? TRIAL_NOTE : OPEN_ACCESS_REASONS.has(status.reason) ? OPEN_ACCESS_NOTE : null;

  return (
    <SurfaceCard className="flex flex-col gap-5 p-6 sm:p-8">
      <h2 className="sr-only">המנוי שלכם</h2>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        {trial ? (
          <TrialSummary trial={trial} credits={credits} size="lg" />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
            {hasCredits ? (
              <CreditsMeter credits={credits} />
            ) : (
              <p className="text-base leading-relaxed text-espresso">בחרו תוכנית, והסוכן שלכם יעבוד בשבילכם כל יום.</p>
            )}
          </div>
        )}
        {canChoosePlan ? (
          <a href={`#${SETTINGS_SECTION.plans}`} className={`${PRIMARY_ACTION} sm:shrink-0 sm:px-6`}>
            בחירת תוכנית
          </a>
        ) : null}
      </div>
      {note ? <p className="text-sm leading-relaxed text-espresso-light">{note}</p> : null}
    </SurfaceCard>
  );
}

function subscriptionLabel(status: BillingStatus): { tone: Tone; text: string } {
  const sub = status.subscription;
  if (!sub) return { tone: "muted", text: "ללא מנוי" };
  switch (sub.status) {
    case "trialing":
      return { tone: "good", text: "תקופת ניסיון של המנוי" };
    case "active":
      return sub.cancelAtPeriodEnd ? { tone: "warn", text: "מבוטל, פעיל עד סוף התקופה" } : { tone: "good", text: "פעיל" };
    case "past_due":
      return { tone: "warn", text: "תשלום נכשל" };
    case "canceled":
      return status.paid ? { tone: "warn", text: "מבוטל, פעיל עד סוף התקופה" } : { tone: "muted", text: "הסתיים" };
    case "paused":
      return { tone: "warn", text: "מושהה" };
    case "unpaid":
      return { tone: "warn", text: "לא שולם" };
    case "expired":
      return { tone: "muted", text: "פג תוקף" };
  }
}

export function SubscriptionHero({
  status,
  ending,
  periodEnd,
  scheduled,
  actions,
}: {
  status: BillingStatus;
  ending: boolean;
  periodEnd: string | null;
  scheduled: Plan | null;
  actions: ReactNode;
}) {
  const label = subscriptionLabel(status);
  const billingLine = ending
    ? `פעיל עד ${periodEnd}`
    : scheduled
      ? `עוברים לתוכנית ${planLabel(scheduled)} ב־${periodEnd} · החיוב הבא ${formatIls(scheduled.priceIls)}`
      : `חיוב ${intervalAdjective(status.plan.interval)} · החיוב הבא ${formatIls(status.plan.priceIls)} ב־${periodEnd}`;

  return (
    <SurfaceCard className="flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-display text-3xl leading-tight text-espresso">{planLabel(status.plan)}</h2>
            <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
          </div>
          {periodEnd ? <p className="text-sm text-espresso-light">{billingLine}</p> : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">{actions}</div>
      </div>
      <CreditsMeter credits={status.credits} planEndsAt={status.subscription?.currentPeriodEnd ?? null} />
    </SurfaceCard>
  );
}

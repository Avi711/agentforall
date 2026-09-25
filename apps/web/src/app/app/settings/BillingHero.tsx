import type { ReactNode } from "react";
import type { EntitlementReason } from "@/lib/billing/entitlement";
import { formatCredits, formatDay, formatIls, planLabel } from "@/lib/billing/format";
import type { BillingInterval, Plan } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import { ROW_ACTION_CLASS } from "../action-buttons";
import { daysLeftLabel } from "../credits-copy";
import { StatusLabel, type Tone } from "../Marks";
import { CreditBreakdown } from "./CreditBreakdown";

const TRIAL_NOTE = "כשהניסיון נגמר הסוכן מפסיק לענות. בחרו תוכנית והוא ימשיך בלי הפסקה, עם כל ההגדרות והחיבורים שלו.";
const OPEN_ACCESS_NOTE = "הגישה שלכם פתוחה כרגע ללא מנוי. אפשר להצטרף כבר עכשיו כדי לשמור על הסוכן גם בהמשך.";
const OPEN_ACCESS_REASONS: ReadonlySet<EntitlementReason> = new Set(["beta_access", "enforcement_disabled"]);
const PER_INTERVAL: Record<BillingInterval, string> = { month: "לחודש", year: "לשנה" };

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
    <div className="flex flex-col gap-5 p-6 sm:p-8">
      <h2 className="sr-only">המנוי שלכם</h2>
      {trial ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLabel tone="good">ניסיון חינם</StatusLabel>
          <span className="text-[13px] text-espresso-light">{daysLeftLabel(trial.daysLeft)}</span>
        </p>
      ) : (
        <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
      )}
      {trial || hasCredits ? (
        <CreditBreakdown credits={credits} renews={false} />
      ) : (
        <p className="text-base leading-relaxed text-espresso">בחרו תוכנית, והסוכן שלכם יעבוד בשבילכם כל יום.</p>
      )}
      {note ? <p className="text-sm leading-relaxed text-espresso-light">{note}</p> : null}
      {canChoosePlan ? (
        <div className="flex sm:justify-end">
          <a href={`#${SETTINGS_SECTION.plans}`} className={`${ROW_ACTION_CLASS.quiet} w-full sm:w-auto`}>
            לבחירת תוכנית
          </a>
        </div>
      ) : null}
    </div>
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

function billingLine(status: BillingStatus, ending: boolean, scheduled: Plan | null): string {
  const price = `${formatIls(status.plan.priceIls)} ${PER_INTERVAL[status.plan.interval]}`;
  const end = status.subscription?.currentPeriodEnd;
  if (!end || status.subscription?.status === "past_due") return price;
  const day = formatDay(end);
  if (ending) return `פעיל עד ${day}, בלי חיובים נוספים`;
  if (scheduled) return `עוברים ל${planLabel(scheduled)} ב־${day}, ואז ${formatIls(scheduled.priceIls)} ${PER_INTERVAL[scheduled.interval]}`;
  return `${price}, החיוב הבא ב־${day}`;
}

export function SubscriptionHero({
  status,
  ending,
  scheduled,
  actions,
}: {
  status: BillingStatus;
  ending: boolean;
  scheduled: Plan | null;
  actions: ReactNode;
}) {
  const label = subscriptionLabel(status);
  const renews = status.paid && !ending && Boolean(status.subscription?.currentPeriodEnd) && status.subscription?.status !== "past_due";
  const nextPlan = scheduled ?? status.plan;

  return (
    <div className="flex flex-col gap-6 p-6 sm:grid sm:grid-cols-[1fr_auto] sm:gap-x-6 sm:p-8">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-display text-2xl leading-tight text-espresso">{planLabel(status.plan)}</h2>
          <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
        </div>
        <p className="text-sm text-espresso-light">{billingLine(status, ending, scheduled)}</p>
      </div>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <CreditBreakdown credits={status.credits} renews={renews} />
        {renews ? (
          <p className="text-sm text-espresso-light">
            בחידוש, הקרדיטים מהתוכנית מתאפסים ל־{formatCredits(nextPlan.includedCredits)}. מה שלא נוצל לא עובר הלאה.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 empty:hidden sm:col-start-2 sm:row-start-1 sm:flex-row sm:items-start">{actions}</div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { BillingIntervalToggle } from "@/components/pricing/BillingIntervalToggle";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PLAN_COPY } from "@/content/plans.he";
import { formatAgorot, formatCredits, formatDate, formatDay, formatIls, planLabel } from "@/lib/billing/format";
import { PLAN_CATALOGUE, PLANS, monthlyCredits, planChangeBilling, type Plan, type PlanCode } from "@/lib/billing/pricing";
import type { BillingStatus, PlanChangePreview } from "@/lib/billing/service";
import { ROW_ACTION_CLASS } from "../action-buttons";
import { BillingClientError, changePlan, previewPlanChange } from "../billing/client";
import { ConfirmDialog } from "../ConfirmDialog";
import { BusyLabel, CloseButton, SummaryRows } from "../Marks";
import { useActionRunner } from "../useActionRunner";
import { useRevealWhenOpened } from "../useRevealWhenOpened";
import { CardSection, SUBSECTION_TITLE } from "./Section";

const PER_INTERVAL = { month: "לחודש", year: "לשנה" } as const;

export interface PlanChangeNotice {
  message: string;
  awaitsCredits: boolean;
}

export function PlanChangePanel({
  status,
  scheduledPlan,
  onChanged,
  onClose,
  onUpdatePaymentMethod,
}: {
  status: BillingStatus;
  scheduledPlan: Plan | null;
  onChanged: (status: BillingStatus, notice: PlanChangeNotice) => void;
  onClose: () => void;
  onUpdatePaymentMethod: () => void;
}) {
  const { pending, error, run } = useActionRunner<PlanCode>();
  const [interval, setBillingInterval] = useState(status.plan.interval);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [declined, setDeclined] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRevealWhenOpened<HTMLElement>(true);
  const periodEnd = formatDate(status.subscription?.currentPeriodEnd ?? null);
  const target = preview ? PLANS[preview.plan] : null;
  const chargesNow = preview?.billing === "prorate_now" && preview.chargeNowAgorot !== null;
  const renewalDay = status.subscription?.currentPeriodEnd ? formatDay(status.subscription.currentPeriodEnd, status.credits.asOf) : null;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  async function confirm(chosen: PlanChangePreview, plan: Plan) {
    try {
      const next = await changePlan(chosen.plan);
      setPreview(null);
      onChanged(next, changedNotice(chosen, plan, periodEnd));
    } catch (err) {
      if (!(err instanceof BillingClientError && err.code === "payment_declined")) throw err;
      setPreview(null);
      setDeclined(true);
    }
  }

  return (
    <CardSection id="change-plan" labelledBy="change-plan-title" tinted sectionRef={sectionRef}>
      <header className="flex items-center justify-between gap-4">
        <h3 id="change-plan-title" ref={headingRef} tabIndex={-1} className={`${SUBSECTION_TITLE} focus:outline-none`}>
          מעבר לתוכנית אחרת
        </h3>
        <CloseButton onClick={onClose} />
      </header>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex">
          <BillingIntervalToggle value={interval} onChange={setBillingInterval} disabled={pending !== null} />
        </div>
        <ul className="divide-y divide-sand-light/70 rounded-2xl border border-sand-light bg-white">
          {PLAN_CATALOGUE.filter((plan) => plan.interval === interval).map((plan) => (
            <li key={plan.code} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-[15px] font-semibold text-espresso">{plan.name}</p>
                <p className="text-[13px] text-espresso-light">{PLAN_COPY[plan.tier].tagline}</p>
              </div>
              <div className="flex flex-col gap-0.5 tabular-nums sm:w-40">
                <p className="text-sm font-semibold text-espresso">
                  {formatIls(plan.priceIls)} {PER_INTERVAL[plan.interval]}
                </p>
                <p className="text-[13px] text-espresso-light">{formatCredits(monthlyCredits(plan))} קרדיטים בחודש</p>
              </div>
              <div className="flex flex-col gap-1.5 sm:w-48 sm:items-end">
                {plan.code === status.plan.code || plan.code === scheduledPlan?.code ? (
                  <p className="text-sm font-semibold text-espresso-light">
                    {plan.code === status.plan.code ? "התוכנית הנוכחית" : "המעבר כבר נקבע"}
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={pending !== null}
                      aria-busy={pending === plan.code}
                      aria-describedby={`timing-${plan.code}`}
                      onClick={() => {
                        setDeclined(false);
                        void run(plan.code, async () => setPreview(await previewPlanChange(plan.code)));
                      }}
                      className={`${ROW_ACTION_CLASS.quiet} w-full sm:w-auto`}
                    >
                      <BusyLabel busy={pending === plan.code} busyText="מחשבים מחיר…">
                        {actionLabel(plan, status.plan)}
                      </BusyLabel>
                    </button>
                    <p id={`timing-${plan.code}`} className="text-xs text-espresso-light">
                      {timingOf(plan, status.plan, renewalDay)}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {declined ? (
          <ErrorAlert>
            הכרטיס סורב ולא חויבתם. אפשר לנסות שוב אחרי{" "}
            <button type="button" onClick={onUpdatePaymentMethod} className="font-semibold underline">
              עדכון אמצעי התשלום
            </button>
            .
          </ErrorAlert>
        ) : (
          <ErrorAlert>{error}</ErrorAlert>
        )}
        {preview && target ? (
          <ConfirmDialog
            open
            title={`מעבר לתוכנית ${planLabel(target)}`}
            description={<PlanChangeSummary preview={preview} current={status.plan} target={target} periodEnd={periodEnd} />}
            confirmLabel={
              chargesNow
                ? `אישור ותשלום ${formatAgorot(preview.chargeNowAgorot ?? 0)}`
                : preview.billing === "at_renewal" && renewalDay
                  ? `מעבר ל${planLabel(target)} ב־${renewalDay}`
                  : "אישור המעבר"
            }
            cancelLabel={preview.billing === "at_renewal" ? `להישאר ב${planLabel(status.plan)}` : "ביטול"}
            busyLabel={preview.billing === "prorate_now" ? "מחייבים…" : "מעדכנים…"}
            onClose={() => setPreview(null)}
            onConfirm={() => confirm(preview, target)}
          />
        ) : null}
      </div>
    </CardSection>
  );
}

function timingOf(plan: Plan, current: Plan, renewalDay: string | null): string {
  if (planChangeBilling(current, plan) === "prorate_now") {
    return plan.interval === current.interval ? "מתחיל מיד, בתשלום יחסי" : "מתחיל היום, לשנה שלמה";
  }
  return `${renewalDay ? `מ־${renewalDay}` : "מהחידוש הבא"}, בלי חיוב עכשיו`;
}

function actionLabel(plan: Plan, current: Plan): string {
  return plan.interval === current.interval && plan.priceIls > current.priceIls ? `שדרוג ל${plan.name}` : `מעבר ל${planLabel(plan)}`;
}

function PlanChangeSummary({
  preview,
  current,
  target,
  periodEnd,
}: {
  preview: PlanChangePreview;
  current: Plan;
  target: Plan;
  periodEnd: string | null;
}) {
  const nextChargeAt = formatDate(preview.nextChargeAt);
  const recurring = nextChargeAt
    ? (
        <SummaryGroup
          title={`מ־${nextChargeAt}`}
          rows={[
            ...(preview.nextChargeAgorot !== null
              ? [{ label: target.interval === "year" ? "כל שנה" : "כל חודש", value: formatAgorot(preview.nextChargeAgorot) }]
              : []),
            { label: "קרדיטים בחודש", value: formatCredits(monthlyCredits(target)) },
          ]}
        />
      )
    : null;

  if (preview.billing === "at_renewal") {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-semibold text-espresso">אין חיוב עכשיו.</p>
        <p>
          תוכנית {planLabel(current)} והקרדיטים שלה נשארים עד {periodEnd ?? "החידוש"}. קרדיטים מהתוכנית שלא נוצלו עד אז לא עוברים הלאה,
          וקרדיטים מטעינות נשארים.
        </p>
        {recurring}
      </div>
    );
  }

  const toYearly = target.interval !== current.interval;
  const creditNote =
    preview.creditAgorot > 0
      ? `הסכום כולל זיכוי של ${formatAgorot(preview.creditAgorot)} על ${toYearly ? "יתרת החודש" : `יתרת תוכנית ${planLabel(current)}`}. `
      : "";
  return (
    <div className="flex flex-col gap-4">
      <p>
        {toYearly
          ? `תוכנית ${planLabel(target)} מתחילה היום לשנה שלמה.`
          : `תוכנית ${planLabel(target)} מתחילה מיד, והחיוב מכסה את יתרת התקופה הנוכחית.`}
      </p>
      <SummaryGroup
        title="היום"
        rows={[
          ...(preview.chargeNowAgorot === null ? [] : [{ label: "לתשלום", value: formatAgorot(preview.chargeNowAgorot) }]),
          { label: "קרדיטים שנוספים", value: formatCredits(preview.credits) },
        ]}
      />
      {recurring}
      <p className="text-xs">
        {creditNote}החיוב מהכרטיס השמור במנוי, כולל מע״מ.{toYearly ? " שינוי של תוכנית שנתית אפשרי אחר כך רק דרכנו." : ""}
      </p>
    </div>
  );
}

function SummaryGroup({ title, rows }: { title: string; rows: readonly { label: string; value: string }[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-espresso-light">{title}</p>
      <SummaryRows rows={rows} />
    </div>
  );
}

function changedNotice(preview: PlanChangePreview, target: Plan, periodEnd: string | null): PlanChangeNotice {
  if (preview.billing === "prorate_now") return { message: `עברתם לתוכנית ${planLabel(target)}.`, awaitsCredits: preview.credits > 0 };
  return { message: `המעבר לתוכנית ${planLabel(target)} ייכנס לתוקף ${periodEnd ? `ב־${periodEnd}` : "בחידוש הבא"}.`, awaitsCredits: false };
}

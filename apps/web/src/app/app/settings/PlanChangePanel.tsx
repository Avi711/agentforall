"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { formatAgorot, formatCredits, formatDate, formatDay, planLabel } from "@/lib/billing/format";
import { PLANS, monthlyCredits, type Plan, type PlanCode } from "@/lib/billing/pricing";
import type { BillingStatus, PlanChangePreview } from "@/lib/billing/service";
import { BillingClientError, changePlan, previewPlanChange } from "../billing/client";
import { PlanCheckout } from "../billing/PlanCheckout";
import { ConfirmDialog } from "../ConfirmDialog";
import { SummaryRows } from "../Marks";
import { useActionRunner } from "../useActionRunner";

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
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [declined, setDeclined] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const periodEnd = formatDate(status.subscription?.currentPeriodEnd ?? null);
  const target = preview ? PLANS[preview.plan] : null;
  const chargesNow = preview?.billing === "prorate_now" && preview.chargeNowAgorot !== null;
  const renewalDay = status.subscription?.currentPeriodEnd ? formatDay(status.subscription.currentPeriodEnd) : null;

  useEffect(() => {
    headingRef.current?.focus();
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
    <section id="change-plan" aria-labelledby="change-plan-title" className="flex scroll-mt-24 flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="change-plan-title" ref={headingRef} tabIndex={-1} className="font-display text-2xl text-espresso focus:outline-none">
            מעבר לתוכנית אחרת
          </h2>
          <p className="text-sm leading-relaxed text-espresso-light">
            שדרוג מתחיל מיד, והסכום המדויק מוצג לפני האישור. מעבר לתוכנית זולה יותר נכנס לתוקף בחידוש הבא, בלי חיוב עכשיו.
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-espresso-light underline hover:text-espresso">
          סגירה
        </button>
      </header>
      <PlanCheckout
        currentPlan={status.plan.code}
        scheduledPlan={scheduledPlan?.code ?? null}
        initialInterval={status.plan.interval}
        pendingPlan={pending}
        disabled={pending !== null}
        busyText="מחשבים מחיר…"
        onChoose={(code) => {
          setDeclined(false);
          void run(code, async () => setPreview(await previewPlanChange(code)));
        }}
      />
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
    </section>
  );
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

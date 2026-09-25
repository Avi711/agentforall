"use client";

import { useState } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { formatAgorot, formatCredits, formatDate, planLabel } from "@/lib/billing/format";
import { PLANS, findPlan, monthlyCredits, type Plan, type PlanCode } from "@/lib/billing/pricing";
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
  onChanged,
  onClose,
  onUpdatePaymentMethod,
}: {
  status: BillingStatus;
  onChanged: (status: BillingStatus, notice: PlanChangeNotice) => void;
  onClose: () => void;
  onUpdatePaymentMethod: () => void;
}) {
  const { pending, error, run } = useActionRunner<PlanCode>();
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [declined, setDeclined] = useState(false);
  const periodEnd = formatDate(status.subscription?.currentPeriodEnd ?? null);
  const target = preview ? PLANS[preview.plan] : null;
  const chargesNow = preview?.billing === "prorate_now" && preview.chargeNowAgorot !== null;

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
    <section aria-labelledby="change-plan-title" className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="change-plan-title" className="font-display text-2xl text-espresso">
            מעבר לתוכנית אחרת
          </h2>
          <p className="text-sm leading-relaxed text-espresso-light">
            שדרוג מתחיל מיד, בחיוב על יתרת התקופה. מעבר לתוכנית זולה יותר נכנס לתוקף בחידוש הבא, בלי חיוב עכשיו.
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-espresso-light underline hover:text-espresso">
          סגירה
        </button>
      </header>
      <PlanCheckout
        currentPlan={status.plan.code}
        scheduledPlan={findPlan(status.subscription?.scheduledPlanCode ?? null)?.code ?? null}
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
          confirmLabel={chargesNow ? `אישור ותשלום ${formatAgorot(preview.chargeNowAgorot ?? 0)}` : "אישור המעבר"}
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
  const nextCharge = preview.nextChargeAgorot !== null && nextChargeAt ? [{ label: "החיוב הבא", value: `${formatAgorot(preview.nextChargeAgorot)} ב־${nextChargeAt}` }] : [];
  const monthly = { label: "קרדיטים בכל חודש", value: formatCredits(monthlyCredits(target)) };

  if (preview.billing === "at_renewal") {
    return (
      <div className="flex flex-col gap-4">
        <p>
          אין חיוב עכשיו. תוכנית {planLabel(current)} והקרדיטים שלה נשארים עד {periodEnd ?? "סוף התקופה"}, ומשם ממשיכים בתוכנית{" "}
          {planLabel(target)}.
        </p>
        <SummaryRows rows={[...nextCharge, monthly]} />
      </div>
    );
  }

  const toYearly = target.interval !== current.interval;
  const credit =
    preview.creditAgorot > 0
      ? [{ label: toYearly ? "זיכוי על יתרת החודש" : `זיכוי על תוכנית ${planLabel(current)}`, value: `−${formatAgorot(preview.creditAgorot)}` }]
      : [];
  const chargeNow = preview.chargeNowAgorot === null ? [] : [{ label: "לתשלום עכשיו", value: formatAgorot(preview.chargeNowAgorot) }];
  return (
    <div className="flex flex-col gap-4">
      <p>
        {toYearly
          ? `תוכנית ${planLabel(target)} מתחילה היום לשנה שלמה.`
          : `תוכנית ${planLabel(target)} מתחילה מיד, עד סוף התקופה הנוכחית.`}
      </p>
      <SummaryRows
        rows={[...credit, ...chargeNow, { label: "קרדיטים שנוספים עכשיו", value: formatCredits(preview.credits) }, monthly, ...nextCharge]}
      />
      <p className="text-xs">
        החיוב מהכרטיס השמור במנוי, כולל מע״מ.{toYearly ? " שינוי של תוכנית שנתית אפשרי אחר כך רק דרכנו." : ""}
      </p>
    </div>
  );
}

function changedNotice(preview: PlanChangePreview, target: Plan, periodEnd: string | null): PlanChangeNotice {
  if (preview.billing === "prorate_now") return { message: `עברתם לתוכנית ${planLabel(target)}.`, awaitsCredits: preview.credits > 0 };
  return { message: `המעבר לתוכנית ${planLabel(target)} ייכנס לתוקף ${periodEnd ? `ב־${periodEnd}` : "בחידוש הבא"}.`, awaitsCredits: false };
}

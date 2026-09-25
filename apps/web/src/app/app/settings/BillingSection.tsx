"use client";

import { useState, type ReactNode } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { BusinessOffer } from "@/components/pricing/BusinessOffer";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/pricing/styles";
import { TrustPoints } from "@/components/pricing/TrustPoints";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { CREDITS_EXPLAINER } from "@/content/plans.he";
import { formatDate } from "@/lib/billing/format";
import { isPlanCode, type PlanCode } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_SECTION, type CheckoutReturn } from "@/lib/billing/urls";
import {
  cancelSubscription,
  changePlan,
  fetchPortalUrl,
  fetchUpdatePaymentMethodUrl,
  resumeSubscription,
  startCheckout,
} from "../billing/client";
import { PlanCheckout } from "../billing/PlanCheckout";
import { BusyLabel, SurfaceCard } from "../Marks";
import { useActionRunner } from "../useActionRunner";
import { ChoosePlanHero, SubscriptionHero } from "./BillingHero";
import { CancelConfirm, ManageBilling, type ManageOption } from "./ManageBilling";
import { TopupCard } from "./TopupCard";
import { useCheckoutVerification, useForgetCheckoutReturn, type CheckoutVerification } from "./useCheckoutReturn";

type PendingAction = "cancel" | "resume" | "portal" | "paymentMethod" | PlanCode;
type Panel = "none" | "cancel" | "changePlan";

export function BillingSection({
  initial,
  checkoutResult,
  checkoutSessionId,
}: {
  initial: BillingStatus;
  checkoutResult: CheckoutReturn | null;
  checkoutSessionId: string | null;
}) {
  const [status, setStatus] = useState(initial);
  const [panel, setPanel] = useState<Panel>("none");
  const { pending, error, run, redirect } = useActionRunner<PendingAction>();
  const verification = useCheckoutVerification(checkoutResult === "success" ? checkoutSessionId : null, setStatus);
  useForgetCheckoutReturn(checkoutResult !== null);

  const sub = status.subscription;
  const busy = pending !== null;
  const pendingPlan = pending !== null && isPlanCode(pending) ? pending : null;
  const overdue = sub?.status === "past_due" && !status.capabilities.cancelWhilePastDue;
  const managesBilling = status.paid || overdue;
  const ending = Boolean(sub?.cancelAtPeriodEnd || sub?.status === "canceled");
  const periodEnd = formatDate(sub?.currentPeriodEnd ?? null);
  const canChangePlan = status.paid && !overdue && status.available && status.plan.interval === "month";

  const updatePaymentMethod = () => redirect("paymentMethod", fetchUpdatePaymentMethodUrl);

  const heroActions: ReactNode[] = [];
  if (overdue && status.capabilities.updatePaymentMethod) {
    heroActions.push(
      <button key="paymentMethod" type="button" disabled={busy} onClick={updatePaymentMethod} className={`${PRIMARY_ACTION} sm:px-6`}>
        <BusyLabel busy={pending === "paymentMethod"} busyText="פותחים…">עדכון אמצעי תשלום</BusyLabel>
      </button>,
    );
  }
  if (status.paid && ending && status.capabilities.resume) {
    heroActions.push(
      <button
        key="resume"
        type="button"
        disabled={busy}
        onClick={() => run("resume", async () => setStatus(await resumeSubscription()))}
        className={`${PRIMARY_ACTION} sm:px-6`}
      >
        <BusyLabel busy={pending === "resume"} busyText="מחדשים…">חידוש המנוי</BusyLabel>
      </button>,
    );
  }
  if (canChangePlan) {
    heroActions.push(
      <button
        key="changePlan"
        type="button"
        disabled={busy}
        aria-expanded={panel === "changePlan"}
        onClick={() => setPanel(panel === "changePlan" ? "none" : "changePlan")}
        className={SECONDARY_ACTION}
      >
        שינוי תוכנית
      </button>,
    );
  }
  if (status.paid && !overdue && status.plan.interval === "year") {
    heroActions.push(
      <WhatsAppChatLink key="yearly" text="היי, אני רוצה לשנות את התוכנית השנתית שלי" className={SECONDARY_ACTION}>
        שינוי תוכנית שנתית דרכנו
      </WhatsAppChatLink>,
    );
  }

  const manageOptions: ManageOption[] = [];
  if (managesBilling && !overdue && status.capabilities.updatePaymentMethod) {
    manageOptions.push({
      key: "paymentMethod",
      title: "אמצעי תשלום",
      detail: "עדכון הכרטיס לחיובים הבאים",
      pending: pending === "paymentMethod",
      onSelect: updatePaymentMethod,
    });
  }
  if (managesBilling && status.capabilities.customerPortal) {
    manageOptions.push({
      key: "portal",
      title: "חשבוניות ותשלומים",
      detail: "כל החיובים והקבלות",
      pending: pending === "portal",
      onSelect: () => redirect("portal", fetchPortalUrl),
    });
  }
  if (status.paid && !overdue && sub && !ending && status.capabilities.cancel) {
    manageOptions.push({
      key: "cancel",
      title: "ביטול המנוי",
      detail: `הסוכן ימשיך לעבוד עד ${periodEnd ?? "סוף תקופת החיוב"}`,
      pending: false,
      onSelect: () => setPanel("cancel"),
    });
  }

  const canChoosePlan = !managesBilling && status.available && !verification.verifying;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <CheckoutNotices checkoutResult={checkoutResult} verification={verification} />

      {overdue ? (
        <Notice tone="warn">
          החיוב האחרון נכשל. עדכנו אמצעי תשלום כדי שהסוכן ימשיך לעבוד, או{" "}
          <WhatsAppChatLink text="היי, החיוב במנוי שלי נכשל">כתבו לנו</WhatsAppChatLink> אם תרצו לבטל.
        </Notice>
      ) : null}

      {managesBilling ? (
        <SubscriptionHero status={status} ending={ending} periodEnd={periodEnd} actions={heroActions} />
      ) : (
        <ChoosePlanHero status={status} canChoosePlan={canChoosePlan} />
      )}

      {panel === "changePlan" && canChangePlan ? (
        <section aria-labelledby="change-plan-title" className="flex flex-col gap-4">
          <header className="flex flex-col gap-1.5">
            <h2 id="change-plan-title" className="font-display text-2xl text-espresso">
              מעבר לתוכנית אחרת
            </h2>
            <p className="text-sm leading-relaxed text-espresso-light">
              התוכנית הנוכחית תסתיים בסוף התקופה ששולמה, והחדשה תתחיל מיד עם התשלום. הקרדיטים שנותרו נשמרים עד סוף התקופה.
            </p>
          </header>
          <PlanCheckout
            currentPlan={ending ? null : status.plan.code}
            initialInterval={status.plan.interval}
            pendingPlan={pendingPlan}
            disabled={busy}
            onChoose={(code) => redirect(code, () => changePlan(code))}
          />
        </section>
      ) : null}

      {canChoosePlan ? (
        <section id={SETTINGS_SECTION.plans} aria-labelledby="plans-title" className="flex scroll-mt-24 flex-col gap-6">
          <header className="flex flex-col gap-1.5">
            <h2 id="plans-title" className="font-display text-3xl text-espresso">
              בחרו תוכנית
            </h2>
            <p className="text-sm text-espresso-light">המחירים כוללים מע״מ. אפשר לשנות או לבטל בכל עת.</p>
          </header>
          <PlanCheckout pendingPlan={pendingPlan} disabled={busy} onChoose={(code) => redirect(code, () => startCheckout(code))} />
          <BusinessOffer />
          <TrustPoints />
        </section>
      ) : null}

      {!managesBilling && !status.available ? (
        <Notice tone="info">
          התשלומים ייפתחו בקרוב. עד אז, <WhatsAppChatLink text="היי, אני רוצה להצטרף למנוי">דברו איתנו</WhatsAppChatLink> ונסדר את
          זה יחד.
        </Notice>
      ) : null}

      {status.creditsAction === "topup" ? <TopupCard terms={status.topup} /> : null}

      {managesBilling ? (
        <ManageBilling options={manageOptions} disabled={busy}>
          {panel === "cancel" ? (
            <CancelConfirm
              periodEnd={periodEnd}
              busy={busy}
              pending={pending === "cancel"}
              onConfirm={() =>
                run("cancel", async () => {
                  setStatus(await cancelSubscription());
                  setPanel("none");
                })
              }
              onClose={() => setPanel("none")}
            />
          ) : null}
        </ManageBilling>
      ) : (
        <SurfaceCard className="flex flex-col gap-3 p-6 sm:p-8">
          <h2 className="font-display text-xl text-espresso">מה זה קרדיט?</h2>
          <p className="text-sm leading-relaxed text-espresso-light">{CREDITS_EXPLAINER}</p>
        </SurfaceCard>
      )}

      <ErrorAlert>{error}</ErrorAlert>
    </div>
  );
}

function CheckoutNotices({ checkoutResult, verification }: { checkoutResult: CheckoutReturn | null; verification: CheckoutVerification }) {
  if (verification.verifying) return <Notice tone="info">מאמתים את התשלום מול ספק הסליקה… זה לוקח בדרך כלל כמה שניות.</Notice>;
  if (verification.outcome === "completed") return <Notice tone="info">התשלום אושר. תודה!</Notice>;
  if (verification.outcome === "timed_out") {
    return (
      <Notice tone="warn">
        התשלום עדיין לא אושר אצלנו. אם חויבתם, הגישה תיפתח אוטומטית תוך דקות ספורות, ואם לא,{" "}
        <WhatsAppChatLink text="היי, שילמתי אבל המנוי עדיין לא אושר">דברו איתנו</WhatsAppChatLink>.
      </Notice>
    );
  }
  if (checkoutResult === "failed" || verification.outcome === "failed") {
    return <Notice tone="warn">התשלום לא הושלם ולא חויבתם. אפשר לנסות שוב.</Notice>;
  }
  return null;
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
  const color = tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sand-light bg-cream-dark/60 text-espresso";
  return (
    <div role="status" className={`rounded-2xl border p-4 text-sm leading-relaxed ${color}`}>
      {children}
    </div>
  );
}

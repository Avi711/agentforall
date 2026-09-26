"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { BusinessOffer } from "@/components/pricing/BusinessOffer";
import { TrustPoints } from "@/components/pricing/TrustPoints";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { CREDITS_EXPLAINER } from "@/content/plans.he";
import { formatDate, planLabel } from "@/lib/billing/format";
import { findPlan, isPlanCode, type PlanCode } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import {
  cancelSubscription,
  changePlan,
  fetchBillingStatus,
  fetchPortalUrl,
  fetchUpdatePaymentMethodUrl,
  resumeSubscription,
  startCheckout,
} from "../billing/client";
import { PlanCheckout } from "../billing/PlanCheckout";
import { ROW_ACTION_CLASS } from "../action-buttons";
import { BusyLabel, Spinner, SurfaceCard } from "../Marks";
import { useActionRunner } from "../useActionRunner";
import { usePolling } from "../usePolling";
import { ChoosePlanHero, SubscriptionHero } from "./BillingHero";
import { CreditHistory } from "./CreditHistory";
import { CancelConfirm, ManageBilling, type ManageOption } from "./ManageBilling";
import { PlanChangePanel, type PlanChangeNotice } from "./PlanChangePanel";
import { PageSection } from "./Section";
import { TopupPanel } from "./TopupPanel";

type PendingAction = "cancel" | "resume" | "keep" | "portal" | "paymentMethod" | PlanCode;
type Panel = "none" | "cancel" | "changePlan";

interface Notice extends PlanChangeNotice {
  id: number;
  creditsBefore: number;
}

export function BillingSection({ initial }: { initial: BillingStatus }) {
  const [status, setStatus] = useState(initial);
  const [panel, setPanel] = useState<Panel>("none");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const changePlanRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const runner = useActionRunner<PendingAction>();
  const { pending, error, redirect } = runner;
  // The added credits land with the provider's webhook, seconds after the plan itself changes.
  const credits = usePolling(async () => {
    const next = await fetchBillingStatus();
    if (next.credits.allowance <= (notice?.creditsBefore ?? 0)) return false;
    setStatus(next);
    return true;
  }, notice?.awaitsCredits ? notice.id : null);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const announce = (next: BillingStatus, change: PlanChangeNotice) => {
    setNotice({ ...change, id: Date.now(), creditsBefore: status.credits.allowance });
    setStatus(next);
  };

  const sub = status.subscription;
  const busy = pending !== null;
  const pendingPlan = pending !== null && isPlanCode(pending) ? pending : null;
  const overdue = sub?.status === "past_due" && !status.capabilities.cancelWhilePastDue;
  const managesBilling = status.paid || overdue;
  const ending = Boolean(sub?.cancelAtPeriodEnd || sub?.status === "canceled");
  const periodEnd = sub?.currentPeriodEnd && sub.currentPeriodEnd > status.credits.asOf ? formatDate(sub.currentPeriodEnd) : null;
  const scheduledPlan = findPlan(sub?.scheduledPlanCode ?? null);
  const changesPlans = status.paid && !overdue && !ending && status.available && status.capabilities.changePlan;
  const canChangePlan = changesPlans && status.plan.interval === "month";

  const run = (key: PendingAction, work: () => Promise<void>) => {
    setNotice(null);
    return runner.run(key, work);
  };
  const togglePanel = (next: Panel) => {
    setNotice(null);
    setPanel(panel === next ? "none" : next);
  };
  const updatePaymentMethod = () => redirect("paymentMethod", fetchUpdatePaymentMethodUrl);

  const heroActions: ReactNode[] = [];
  if (overdue && status.capabilities.updatePaymentMethod) {
    heroActions.push(
      <button key="paymentMethod" type="button" disabled={busy} onClick={updatePaymentMethod} className={ROW_ACTION_CLASS.primary}>
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
        className={ROW_ACTION_CLASS.primary}
      >
        <BusyLabel busy={pending === "resume"} busyText="מחדשים…">חידוש המנוי</BusyLabel>
      </button>,
    );
  }
  if (changesPlans && scheduledPlan) {
    heroActions.push(
      <button
        key="keep"
        type="button"
        disabled={busy}
        onClick={() =>
          run("keep", async () =>
            announce(await changePlan(status.plan.code), {
              message: `המעבר לתוכנית ${planLabel(scheduledPlan)} בוטל. ממשיכים בתוכנית ${planLabel(status.plan)}.`,
              awaitsCredits: false,
            }),
          )
        }
        className={ROW_ACTION_CLASS.quiet}
      >
        <BusyLabel busy={pending === "keep"} busyText="מעדכנים…">
          להישאר ב{planLabel(status.plan)}
        </BusyLabel>
      </button>,
    );
  }
  if (canChangePlan) {
    heroActions.push(
      <button
        key="changePlan"
        ref={changePlanRef}
        type="button"
        disabled={busy}
        aria-expanded={panel === "changePlan"}
        aria-controls={panel === "changePlan" ? "change-plan" : undefined}
        onClick={() => togglePanel("changePlan")}
        className={ROW_ACTION_CLASS.quiet}
      >
        שינוי תוכנית
      </button>,
    );
  }
  if (status.paid && !overdue && status.plan.interval === "year") {
    heroActions.push(
      <WhatsAppChatLink key="yearly" text="היי, אני רוצה לשנות את התוכנית השנתית שלי" className={ROW_ACTION_CLASS.quiet}>
        שינוי תוכנית שנתית דרכנו
      </WhatsAppChatLink>,
    );
  }

  const billingLinks: ManageOption[] = [];
  if (managesBilling && !overdue && status.capabilities.updatePaymentMethod) {
    billingLinks.push({
      title: "אמצעי תשלום",
      detail: "עדכון הכרטיס לחיובים הבאים",
      pending: pending === "paymentMethod",
      external: true,
      onSelect: updatePaymentMethod,
    });
  }
  if (managesBilling && status.capabilities.customerPortal) {
    billingLinks.push({
      title: "חשבוניות וקבלות",
      detail: "כל החיובים, עם קבלה להורדה",
      pending: pending === "portal",
      external: true,
      onSelect: () => redirect("portal", fetchPortalUrl),
    });
  }
  const cancelOption: ManageOption | null =
    status.paid && !overdue && sub && !ending && status.capabilities.cancel
      ? {
          title: "ביטול המנוי",
          detail: `הסוכן ימשיך לעבוד עד ${periodEnd ?? "סוף תקופת החיוב"}`,
          rowRef: cancelRef,
          expanded: panel === "cancel",
          onSelect: () => togglePanel("cancel"),
        }
      : null;

  const canChoosePlan = !managesBilling && status.available;

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <div className="flex flex-col gap-4">
        <div ref={noticeRef} tabIndex={-1} role="status" className="scroll-mt-24 empty:hidden focus:outline-none">
          {notice ? (
            <div className={NOTICE_CLASS.info}>
              {notice.message} {notice.awaitsCredits ? <CreditsArrival state={credits} /> : null}
            </div>
          ) : null}
        </div>

        {overdue ? (
          <Notice tone="warn">
            החיוב האחרון נכשל. עדכנו אמצעי תשלום כדי שהסוכן ימשיך לעבוד, או{" "}
            <WhatsAppChatLink text="היי, החיוב במנוי שלי נכשל">כתבו לנו</WhatsAppChatLink> אם תרצו לבטל.
          </Notice>
        ) : null}

        <SurfaceCard>
          {managesBilling ? (
            <SubscriptionHero status={status} ending={ending} scheduled={scheduledPlan} actions={heroActions} />
          ) : (
            <ChoosePlanHero status={status} canChoosePlan={canChoosePlan} />
          )}
          {panel === "changePlan" && canChangePlan ? (
            <PlanChangePanel
              status={status}
              scheduledPlan={scheduledPlan}
              onChanged={(next, change) => {
                setPanel("none");
                announce(next, change);
              }}
              onClose={() => {
                setPanel("none");
                changePlanRef.current?.focus();
              }}
              onUpdatePaymentMethod={updatePaymentMethod}
            />
          ) : null}
          {status.creditsAction === "topup" ? (
            <TopupPanel terms={status.topup} urgent={status.credits.balance.kind === "low" || status.credits.balance.kind === "out"} />
          ) : null}
        </SurfaceCard>

        <ErrorAlert>{error}</ErrorAlert>
      </div>

      <CreditHistory credits={status.credits} />

      {canChoosePlan ? (
        <section id={SETTINGS_SECTION.plans} aria-labelledby="plans-title" className="flex scroll-mt-24 flex-col gap-6">
          <header className="flex flex-col gap-1.5">
            <h2 id="plans-title" className="font-display text-xl text-espresso sm:text-2xl">
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

      {managesBilling ? (
        <ManageBilling links={billingLinks} cancel={cancelOption} disabled={busy}>
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
              onClose={() => {
                setPanel("none");
                cancelRef.current?.focus();
              }}
            />
          ) : null}
        </ManageBilling>
      ) : (
        <PageSection id="credits" title="מה זה קרדיט?">
          <p className="text-sm leading-relaxed text-espresso-light">{CREDITS_EXPLAINER}</p>
        </PageSection>
      )}
    </div>
  );
}

const NOTICE_CLASS = {
  info: "rounded-2xl border border-sand-light bg-cream-dark/60 p-4 text-sm leading-relaxed text-espresso",
  warn: "rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900",
} as const;

function Notice({ tone, children }: { tone: keyof typeof NOTICE_CLASS; children: ReactNode }) {
  return (
    <div role="status" className={NOTICE_CLASS[tone]}>
      {children}
    </div>
  );
}

function CreditsArrival({ state }: { state: ReturnType<typeof usePolling> }) {
  if (state === "done") return <>הקרדיטים הנוספים כבר בחשבון.</>;
  if (state === "stopped") return <>הקרדיטים הנוספים יתווספו לחשבון תוך כמה דקות.</>;
  return (
    <span className="inline-flex items-center gap-2 text-espresso-light">
      <Spinner />
      מוסיפים את הקרדיטים הנוספים…
    </span>
  );
}

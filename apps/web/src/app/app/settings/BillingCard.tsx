"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Plan, PlanCode } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { formatDate, formatIls } from "@/lib/billing/format";
import { SETTINGS_PATH, type CheckoutReturn } from "@/lib/billing/urls";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { PlanPicker } from "../PlanPicker";
import {
  BillingClientError,
  cancelSubscription,
  changePlan,
  fetchBillingStatus,
  fetchCheckoutSessionStatus,
  fetchPortalUrl,
  fetchUpdatePaymentMethodUrl,
  resumeSubscription,
  startCheckout,
} from "../billing/client";

const VERIFY_POLL_MS = 2_000;
const VERIFY_TIMEOUT_MS = 90_000;

type PendingAction = "checkout" | "cancel" | "resume" | "portal" | "paymentMethod" | "changePlan";

export function BillingCard({
  initial,
  checkoutResult,
  checkoutSessionId,
}: {
  initial: BillingStatus;
  checkoutResult: CheckoutReturn | null;
  checkoutSessionId: string | null;
}) {
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "cancel" | "changePlan">("none");
  const [plan, setPlan] = useState(initial.plan.code);
  const verification = useCheckoutVerification(checkoutResult === "success" ? checkoutSessionId : null, setStatus);
  useForgetCheckoutReturn(checkoutResult !== null);

  async function run(action: PendingAction, work: () => Promise<void>) {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
    } finally {
      setPending(null);
    }
  }

  const sub = status.subscription;
  const busy = pending !== null;
  const periodEnd = formatDate(sub?.currentPeriodEnd ?? null);
  const ending = sub?.cancelAtPeriodEnd || sub?.status === "canceled";

  return (
    <section className="relative bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10 overflow-hidden">
      <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
      <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">מנוי</p>
      <h2 className="font-display text-2xl text-espresso mb-6 leading-tight">התוכנית שלכם</h2>

      <dl className="divide-y divide-sand-light/70 mb-6">
        <Row label="תוכנית" value={`${status.plan.name} · ${formatIls(status.plan.priceIls)} לחודש`} />
        <Row label="מצב" value={<StatusBadge status={status} verifying={verification.verifying} />} />
        {sub && periodEnd ? <Row label={ending ? "מסתיים ב" : "חיוב הבא"} value={periodEnd} /> : null}
      </dl>

      {verification.verifying ? (
        <Notice tone="info">מאמתים את התשלום מול ספק הסליקה… זה לוקח בדרך כלל כמה שניות.</Notice>
      ) : null}
      {verification.outcome === "completed" ? <Notice tone="info">התשלום אושר. תודה!</Notice> : null}
      {verification.outcome === "timed_out" ? (
        <Notice tone="warn">
          התשלום עדיין לא אושר אצלנו. אם חויבתם, הגישה תיפתח אוטומטית תוך דקות ספורות — ואם לא, דברו איתנו.
        </Notice>
      ) : null}
      {checkoutResult === "failed" || verification.outcome === "failed" ? (
        <Notice tone="warn">התשלום לא הושלם ולא חויבתם. אפשר לנסות שוב.</Notice>
      ) : null}
      {sub?.status === "past_due" ? (
        <Notice tone="warn">החיוב האחרון נכשל. עדכנו אמצעי תשלום כדי שהסוכן ימשיך לעבוד.</Notice>
      ) : null}
      {!status.paid && (status.reason === "beta_access" || status.reason === "enforcement_disabled") ? (
        <Notice tone="info">הגישה שלכם פתוחה כרגע ללא מנוי. אפשר להצטרף כבר עכשיו כדי לשמור על הסוכן גם בהמשך.</Notice>
      ) : null}

      {!status.paid && status.available && !verification.verifying ? (
        <div className="mb-5">
          <PlanPicker plans={status.plans} selected={plan} disabled={busy} onSelect={setPlan} />
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        {!status.paid ? (
          status.available ? (
            <PrimaryButton
              pending={pending === "checkout"}
              disabled={busy || verification.verifying}
              onClick={() => run("checkout", async () => window.location.assign(await startCheckout(plan)))}
            >
              {pending === "checkout" ? "מעבירים לתשלום…" : "הצטרפות למנוי"}
            </PrimaryButton>
          ) : (
            <p className="text-sm text-espresso-light">התשלומים ייפתחו בקרוב.</p>
          )
        ) : null}

        {status.paid && sub?.cancelAtPeriodEnd && status.capabilities.resume ? (
          <PrimaryButton
            pending={pending === "resume"}
            disabled={busy}
            onClick={() => run("resume", async () => setStatus(await resumeSubscription()))}
          >
            {pending === "resume" ? "מחדשים…" : "חידוש המנוי"}
          </PrimaryButton>
        ) : null}

        {status.paid && status.available && panel === "none" && status.plans.length > 1 ? (
          <SecondaryButton disabled={busy} onClick={() => setPanel("changePlan")}>
            שינוי תוכנית
          </SecondaryButton>
        ) : null}

        {status.paid && status.capabilities.updatePaymentMethod ? (
          <SecondaryButton
            disabled={busy}
            onClick={() => run("paymentMethod", async () => window.location.assign(await fetchUpdatePaymentMethodUrl()))}
          >
            {pending === "paymentMethod" ? "פותחים…" : "עדכון אמצעי תשלום"}
          </SecondaryButton>
        ) : null}

        {status.paid && status.capabilities.customerPortal ? (
          <SecondaryButton
            disabled={busy}
            onClick={() => run("portal", async () => void window.open(await fetchPortalUrl(), "_blank", "noopener"))}
          >
            {pending === "portal" ? "פותחים…" : "ניהול חשבוניות ותשלומים"}
          </SecondaryButton>
        ) : null}

        {status.paid && sub && !sub.cancelAtPeriodEnd && status.capabilities.cancel && panel === "none" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPanel("cancel")}
            className="px-4 py-3 rounded-lg text-sm text-espresso-light hover:text-red-700 hover:bg-red-50 transition disabled:opacity-50"
          >
            ביטול המנוי
          </button>
        ) : null}
      </div>

      {panel === "changePlan" && sub ? (
        <ChangePlanPanel
          plans={status.plans}
          current={status.plan.code}
          selected={plan}
          busy={busy}
          pending={pending === "changePlan"}
          onSelect={setPlan}
          onConfirm={() => run("changePlan", async () => window.location.assign(await changePlan(plan)))}
          onClose={() => {
            setPanel("none");
            setPlan(status.plan.code);
          }}
        />
      ) : null}

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

      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type VerificationOutcome = "completed" | "failed" | "timed_out";

// Polls the returned session until the provider's callback settles it; a settled session re-renders every card.
function useCheckoutVerification(sessionId: string | null, onStatus: (status: BillingStatus) => void) {
  const router = useRouter();
  const [verifying, setVerifying] = useState(sessionId !== null);
  const [outcome, setOutcome] = useState<VerificationOutcome | null>(null);

  useEffect(() => {
    if (!verifying || sessionId === null) return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = async (result: VerificationOutcome) => {
      if (result === "completed") onStatus(await fetchBillingStatus());
      if (cancelled) return;
      setOutcome(result);
      setVerifying(false);
      if (result === "completed") router.refresh();
    };
    const tick = async () => {
      try {
        const status = await fetchCheckoutSessionStatus(sessionId);
        if (cancelled) return;
        if (status !== "pending") return finish(status);
      } catch (err) {
        if (err instanceof BillingClientError && err.code === "not_found") return finish("failed");
        // Any other failure is transient: the next tick retries and the timeout below ends it.
      }
      if (Date.now() - startedAt > VERIFY_TIMEOUT_MS) return finish("timed_out");
      timer = setTimeout(tick, VERIFY_POLL_MS);
    };
    timer = setTimeout(tick, VERIFY_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [verifying, sessionId, onStatus, router]);

  return { verifying, outcome };
}

// A reload or back-navigation must not replay the checkout return.
function useForgetCheckoutReturn(returned: boolean) {
  useEffect(() => {
    if (returned) window.history.replaceState(window.history.state, "", SETTINGS_PATH);
  }, [returned]);
}

function ChangePlanPanel({
  plans,
  current,
  selected,
  busy,
  pending,
  onSelect,
  onConfirm,
  onClose,
}: {
  plans: readonly Plan[];
  current: PlanCode;
  selected: PlanCode;
  busy: boolean;
  pending: boolean;
  onSelect: (code: PlanCode) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-sand-light bg-cream-dark/40 p-4 space-y-4">
      <PlanPicker plans={plans} selected={selected} current={current} disabled={busy} onSelect={onSelect} />
      <p className="text-xs text-espresso-light leading-relaxed">
        התוכנית הנוכחית תסתיים בסוף התקופה ששולמה, והחדשה תתחיל מיד עם התשלום. הקרדיטים שנותרו מהתוכנית הנוכחית
        נשמרים עד סוף התקופה.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <PrimaryButton pending={pending} disabled={busy || selected === current} onClick={onConfirm}>
          {pending ? "מעבירים לתשלום…" : "מעבר לתוכנית"}
        </PrimaryButton>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="px-5 py-2.5 rounded-lg text-sm text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

function CancelConfirm({
  periodEnd,
  busy,
  pending,
  onConfirm,
  onClose,
}: {
  periodEnd: string | null;
  busy: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-red-200 bg-red-50/60 p-4 space-y-3">
      <p className="text-sm text-espresso leading-relaxed">
        המנוי יישאר פעיל עד {periodEnd ?? "סוף תקופת החיוב"}, ואחר כך הסוכן יפסיק לעבוד. לבטל?
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="px-5 py-2.5 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 transition disabled:opacity-40"
        >
          {pending ? "מבטלים…" : "כן, לבטל את המנוי"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="px-5 py-2.5 rounded-lg text-sm text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-50"
        >
          להשאיר את המנוי
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status, verifying }: { status: BillingStatus; verifying: boolean }) {
  const { label, tone } = statusBadge(status, verifying);
  const color =
    tone === "good"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-900 border-amber-200"
        : "bg-cream-dark text-espresso-light border-sand-light";
  return <span className={`inline-block rounded-full border px-3 py-1 text-xs ${color}`}>{label}</span>;
}

function statusBadge(status: BillingStatus, verifying: boolean): { label: string; tone: "good" | "warn" | "muted" } {
  if (verifying) return { label: "ממתין לאישור תשלום", tone: "warn" };
  const sub = status.subscription;
  if (!sub) {
    if (status.reason === "beta_access") return { label: "גישת בטא", tone: "good" };
    if (status.reason === "trial") return { label: "תקופת ניסיון", tone: "good" };
    return { label: "ללא מנוי", tone: "muted" };
  }
  switch (sub.status) {
    case "trialing":
      return { label: "תקופת ניסיון של המנוי", tone: "good" };
    case "active":
      return sub.cancelAtPeriodEnd ? { label: "מבוטל — פעיל עד סוף התקופה", tone: "warn" } : { label: "פעיל", tone: "good" };
    case "past_due":
      return { label: "תשלום נכשל", tone: "warn" };
    case "canceled":
      return status.paid ? { label: "מבוטל — פעיל עד סוף התקופה", tone: "warn" } : { label: "הסתיים", tone: "muted" };
    case "paused":
      return { label: "מושהה", tone: "warn" };
    case "unpaid":
      return { label: "לא שולם", tone: "warn" };
    case "expired":
      return { label: "פג תוקף", tone: "muted" };
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-3.5 first:pt-0 last:pb-0">
      <dt className="text-xs uppercase tracking-[0.18em] text-espresso-light/80 sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-espresso text-sm break-words">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: React.ReactNode }) {
  const color =
    tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-cream-dark/60 border-sand-light text-espresso";
  return (
    <div role="status" className={`mb-5 text-sm rounded-lg border p-4 leading-relaxed ${color}`}>
      {children}
    </div>
  );
}

function PrimaryButton({
  pending,
  disabled,
  onClick,
  children,
}: {
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending}
      className="px-5 py-3 rounded-lg bg-terra text-white font-medium hover:bg-terra-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-3 rounded-lg border border-sand text-espresso hover:bg-cream-dark transition text-sm font-medium disabled:opacity-50"
    >
      {children}
    </button>
  );
}

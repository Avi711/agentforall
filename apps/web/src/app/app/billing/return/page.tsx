import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getBillingService } from "@/lib/billing";
import type { CheckoutSession } from "@/lib/billing/domain";
import { formatAgorot, formatCredits, formatDate, planLabel } from "@/lib/billing/format";
import { monthlyCredits, planAmountAgorot, resolvePlan } from "@/lib/billing/pricing";
import { CheckoutSessionQuerySchema } from "@/lib/billing/schemas";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_PATH, settingsSectionHref } from "@/lib/billing/urls";
import { toBillingUser } from "@/lib/billing/user";
import { AnimatedCredits } from "../../AnimatedCredits";
import { CheckoutResult, type CheckoutOutcome, type PaymentReceipt } from "./CheckoutResult";

export const metadata: Metadata = {
  title: "תשלום — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession("/login");
  const query = CheckoutSessionQuerySchema.safeParse(await searchParams);
  if (!query.success) redirect(SETTINGS_PATH);
  const billing = getBillingService();
  const user = toBillingUser(session.user);
  const checkout = await billing.findCheckoutSession(user, query.data.session);
  if (!checkout) redirect(SETTINGS_PATH);

  const outcome: CheckoutOutcome =
    checkout.status === "completed" ? { status: "completed", receipt: receiptFor(checkout, await billing.refreshStatus(user)) } : { status: checkout.status };

  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-12 sm:px-6 sm:pt-20">
      <CheckoutResult sessionId={checkout.id} outcome={outcome} retryHref={settingsSectionHref(checkout.kind === "topup" ? "topup" : "plans")} />
    </div>
  );
}

function receiptFor(checkout: CheckoutSession, status: BillingStatus): PaymentReceipt {
  const paid = { label: "שולם", value: formatAgorot(checkout.amountAgorot) };
  if (checkout.kind === "topup") {
    return {
      title: "הקרדיטים נטענו",
      lead: "תודה! הקרדיטים כבר בחשבון ולא פגים.",
      rows: [
        { label: "נטענו", value: <><AnimatedCredits from={0} value={checkout.credits} /> קרדיטים</> },
        paid,
        { label: "יתרה עכשיו", value: `${formatCredits(status.credits.available)} קרדיטים` },
      ],
    };
  }
  const plan = resolvePlan(checkout.productCode);
  const current = status.subscription;
  const nextChargeAt = current?.planCode === plan.code && !current.cancelAtPeriodEnd ? formatDate(current.currentPeriodEnd) : null;
  return {
    title: "התשלום התקבל",
    lead: `תודה! תוכנית ${planLabel(plan)} פעילה והקרדיטים כבר בחשבון.`,
    rows: [
      { label: "תוכנית", value: planLabel(plan) },
      paid,
      { label: "קרדיטים", value: <><AnimatedCredits from={0} value={monthlyCredits(plan)} /> בחודש</> },
      ...(nextChargeAt ? [{ label: "החיוב הבא", value: `${formatAgorot(planAmountAgorot(plan))} ב־${nextChargeAt}` }] : []),
    ],
  };
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getBillingService } from "@/lib/billing";
import { formatCredits } from "@/lib/billing/format";
import { resolvePlan } from "@/lib/billing/pricing";
import { MockPaymentProvider } from "@/lib/billing/providers/mock/adapter";
import { CheckoutSessionQuerySchema } from "@/lib/billing/schemas";
import { toBillingUser } from "@/lib/billing/user";
import { MockCheckoutForm } from "./MockCheckoutForm";

export const metadata: Metadata = {
  title: "תשלום (סביבת פיתוח) — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession("/login");
  const billing = getBillingService();
  if (!(billing.activeProvider instanceof MockPaymentProvider)) notFound();

  const query = CheckoutSessionQuerySchema.safeParse(await searchParams);
  if (!query.success) notFound();
  const checkout = await billing.findCheckoutSession(toBillingUser(session.user), query.data.session);
  if (!checkout || checkout.status !== "pending") notFound();

  const title =
    checkout.kind === "subscription" ? resolvePlan(checkout.productCode).name : `${formatCredits(checkout.credits)} קרדיטים`;
  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28">
      <MockCheckoutForm sessionId={checkout.id} title={title} amountAgorot={checkout.amountAgorot} />
    </div>
  );
}

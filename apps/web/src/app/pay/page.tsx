import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getBillingService, getPaddleClientConfig } from "@/lib/billing";
import { PaddlePayQuerySchema } from "@/lib/billing/schemas";
import { SETTINGS_PATH, checkoutReturnPath } from "@/lib/billing/urls";
import { toBillingUser } from "@/lib/billing/user";
import { PaddleCheckout } from "./PaddleCheckout";

export const metadata: Metadata = {
  title: "תשלום — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Paddle's default payment link: our checkouts carry `session`; Paddle's own links and emails carry `_ptxn` and work signed out.
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const paddle = getPaddleClientConfig();
  if (!paddle) notFound();
  const query = PaddlePayQuerySchema.safeParse(await searchParams);
  if (!query.success) notFound();

  const billing = getBillingService();
  if ("_ptxn" in query.data) {
    const ours = await billing.findCheckoutByProviderCheckoutId("paddle", query.data._ptxn);
    if (ours && !(await billing.isPayable(ours))) redirect(SETTINGS_PATH);
    const successPath = ours ? checkoutReturnPath(ours.id) : SETTINGS_PATH;
    return <PaddleCheckout {...paddle} transactionId={null} email={null} successPath={successPath} exitPath={SETTINGS_PATH} />;
  }

  const session = await requireSession("/login");
  const user = toBillingUser(session.user);
  const checkout = await billing.findCheckoutSession(user, query.data.session);
  if (!checkout || checkout.provider !== "paddle" || !checkout.providerCheckoutId) notFound();
  if (checkout.status !== "pending") redirect(checkoutReturnPath(checkout.id));
  if (!(await billing.isPayable(checkout))) redirect(SETTINGS_PATH);
  return (
    <PaddleCheckout
      {...paddle}
      transactionId={checkout.providerCheckoutId}
      email={user.email}
      successPath={checkoutReturnPath(checkout.id)}
      exitPath={SETTINGS_PATH}
    />
  );
}

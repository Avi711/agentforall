import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { CheckoutBodySchema } from "@/lib/billing/schemas";
import { toBillingUser } from "@/lib/billing/user";

export const POST = authenticatedHandler({ bodySchema: CheckoutBodySchema }, async ({ user, body }) => {
  const { url } = await getBillingService().startCheckout(toBillingUser(user), body.plan);
  return NextResponse.json({ url });
});

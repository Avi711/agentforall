import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { TopupBodySchema } from "@/lib/billing/schemas";
import { toBillingUser } from "@/lib/billing/user";

export const POST = authenticatedHandler({ bodySchema: TopupBodySchema }, async ({ user, body }) => {
  const { url } = await getBillingService().startTopup(toBillingUser(user), body.amountIls);
  return NextResponse.json({ url });
});

import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { toBillingUser } from "@/lib/billing/user";

export const dynamic = "force-dynamic";

export const GET = authenticatedHandler({}, async ({ user }) => {
  const url = await getBillingService().getCustomerPortalUrl(toBillingUser(user));
  return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
});

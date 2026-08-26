import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { toBillingUser } from "@/lib/billing/user";

export const POST = authenticatedHandler({}, async ({ user }) => {
  const status = await getBillingService().cancel(toBillingUser(user));
  return NextResponse.json(status);
});

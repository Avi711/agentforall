import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { ChangePlanBodySchema } from "@/lib/billing/schemas";
import { toBillingUser } from "@/lib/billing/user";

export const POST = authenticatedHandler({ bodySchema: ChangePlanBodySchema }, async ({ user, body }) => {
  return NextResponse.json(await getBillingService().previewPlanChange(toBillingUser(user), body.plan));
});

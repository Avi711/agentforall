import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getMockCheckoutSimulator } from "@/lib/billing";
import { MockCheckoutCompleteBodySchema } from "@/lib/billing/schemas";
import { checkoutReturnPath } from "@/lib/billing/urls";
import { toBillingUser } from "@/lib/billing/user";

export const POST = authenticatedHandler({ bodySchema: MockCheckoutCompleteBodySchema }, async ({ user, body }) => {
  const outcome = await getMockCheckoutSimulator().complete(toBillingUser(user), body.sessionId, body.outcome);
  const redirectTo = checkoutReturnPath(body.sessionId);
  return NextResponse.json({ ok: true, outcome, redirectTo });
});

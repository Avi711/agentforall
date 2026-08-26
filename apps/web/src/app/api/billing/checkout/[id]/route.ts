import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { CheckoutSessionParamsSchema } from "@/lib/billing/schemas";
import { toBillingUser } from "@/lib/billing/user";

export const dynamic = "force-dynamic";

// Polled after the hosted page redirects back, until the provider's callback settles the session.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = CheckoutSessionParamsSchema.safeParse(await ctx.params);
  if (!params.success) return errorJson("not_found", 404);

  return authenticatedHandler({}, async ({ user }) => {
    const session = await getBillingService().findCheckoutSession(toBillingUser(user), params.data.id);
    if (!session) return errorJson("not_found", 404);
    return NextResponse.json({ status: session.status }, { headers: { "Cache-Control": "no-store" } });
  })(req);
}

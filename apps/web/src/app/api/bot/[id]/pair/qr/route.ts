import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getOrchestratorClient } from "@/lib/orchestrator/client";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return authenticatedHandler({ requireConsent: true }, async ({ userId }) => {
    const client = getOrchestratorClient();
    const qr = await client.getPairQr(userId, id);
    return NextResponse.json(qr);
  })(req);
}

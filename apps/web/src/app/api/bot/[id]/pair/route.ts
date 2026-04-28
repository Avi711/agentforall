import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getOrchestratorClient } from "@/lib/orchestrator/client";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return authenticatedHandler({ requireConsent: true }, async ({ userId }) => {
    const client = getOrchestratorClient();
    const result = await client.startPairing(userId, id);
    return NextResponse.json(result);
  })(req);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return authenticatedHandler({}, async ({ userId }) => {
    const client = getOrchestratorClient();
    await client.cancelPairing(userId, id);
    return new NextResponse(null, { status: 204 });
  })(req);
}

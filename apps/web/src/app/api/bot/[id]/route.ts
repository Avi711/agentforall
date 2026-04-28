import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getOrchestratorClient } from "@/lib/orchestrator/client";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return authenticatedHandler({}, async ({ userId }) => {
    const client = getOrchestratorClient();
    const bot = await client.getBot(userId, id);
    return NextResponse.json({ bot });
  })(req);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return authenticatedHandler({}, async ({ userId }) => {
    const client = getOrchestratorClient();
    await client.deleteBot(userId, id);
    return new NextResponse(null, { status: 204 });
  })(req);
}

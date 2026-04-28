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
    const status = await client.getPairStatus(userId, id);
    return NextResponse.json(status, {
      headers: { "cache-control": "no-store" },
    });
  })(req);
}

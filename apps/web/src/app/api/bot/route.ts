import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedHandler } from "@/lib/auth/api";
import { getOrchestratorClient } from "@/lib/orchestrator/client";

// Provision is synchronous in the orchestrator; on the prod VM it takes ~12s
// to create + start the tenant container. Vercel default of 10s would 504.
export const maxDuration = 60;

const CreateBotBody = z.object({
  displayName: z.string().min(1, "שם הבוט חובה").max(60),
});

export const GET = authenticatedHandler({}, async ({ userId }) => {
  const bot = await getOrchestratorClient().findActiveBot(userId);
  return NextResponse.json({ bot });
});

export const POST = authenticatedHandler(
  { bodySchema: CreateBotBody },
  async ({ userId, body }) => {
    const client = getOrchestratorClient();
    const active = await client.findActiveBot(userId);
    if (active) return NextResponse.json({ bot: active });

    const bot = await client.createBot(userId, {
      displayName: body.displayName,
    });
    return NextResponse.json({ bot }, { status: 201 });
  },
);

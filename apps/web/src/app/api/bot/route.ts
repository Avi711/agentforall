import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { CreateBotBodySchema } from "@/lib/bots/schemas";

// Orchestrator returns the row after reserve, before container start; the
// 60s budget is now headroom for a slow round-trip, not the provision itself.
export const maxDuration = 60;

export const GET = authenticatedHandler({}, async ({ userId }) => {
  const bot = await botService.findActiveBot(userId);
  return NextResponse.json({ bot });
});

export const POST = authenticatedHandler(
  { bodySchema: CreateBotBodySchema },
  async ({ userId, body }) => {
    const result = await botService.createBot(userId, body);
    return NextResponse.json(
      { bot: result.bot },
      { status: result.created ? 201 : 200 },
    );
  },
);

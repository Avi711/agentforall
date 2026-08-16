import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BotIdParamsSchema } from "@/lib/bots/schemas";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({ requireConsent: true }, async ({ userId }) => {
    const link = await botService.startTelegramLink(userId, parsed.data.id);
    return NextResponse.json(link, { status: 201 });
  })(req);
}

import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BotIdParamsSchema } from "@/lib/bots/schemas";
import { isWhatsappCloudEnabledFor } from "@/lib/whatsapp-cloud/config";
import { whatsappCloudHealthOf } from "@/lib/whatsapp-cloud/health";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    const bot = await botService.getBot(userId, parsed.data.id);
    const whatsappCloudHealth = await whatsappCloudHealthOf(userId, bot);
    return NextResponse.json({ bot, whatsappCloudHealth, whatsappCloudEnabled: isWhatsappCloudEnabledFor(userId) });
  })(req);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    await botService.deleteBot(userId, parsed.data.id);
    return new NextResponse(null, { status: 204 });
  })(req);
}

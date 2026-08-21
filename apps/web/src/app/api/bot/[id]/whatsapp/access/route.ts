import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BotIdParamsSchema, WhatsappAccessBodySchema } from "@/lib/bots/schemas";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    const access = await botService.getWhatsappAccess(userId, parsed.data.id);
    return NextResponse.json(access);
  })(req);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler(
    { bodySchema: WhatsappAccessBodySchema },
    async ({ userId, body }) => {
      const access = await botService.updateWhatsappAccess(userId, parsed.data.id, body);
      return NextResponse.json(access);
    },
  )(req);
}

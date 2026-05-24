import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BotIdParamsSchema, PhoneBodySchema } from "@/lib/bots/schemas";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler(
    { bodySchema: PhoneBodySchema, requireConsent: true },
    async ({ userId, body }) => {
      const result = await botService.requestPairCode(userId, parsed.data.id, body);
      return NextResponse.json(result);
    },
  )(req);
}

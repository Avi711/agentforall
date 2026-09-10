import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { BotIdParamsSchema } from "@/lib/bots/schemas";
import { getWhatsappCloudService } from "@/lib/whatsapp-cloud/service";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    const view = await getWhatsappCloudService().status(userId, parsed.data.id);
    return NextResponse.json(view);
  })(req);
}

import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { BotIdParamsSchema } from "@/lib/bots/schemas";
import { getIntegrationsService } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    const data = await getIntegrationsService().list(userId, parsed.data.id);
    return NextResponse.json({ data });
  })(req);
}

import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { getIntegrationsService } from "@/lib/integrations";
import { BotIntegrationParamsSchema } from "@/lib/integrations/schemas";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; ref: string }> }) {
  const parsed = BotIntegrationParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    await getIntegrationsService().disconnect(userId, parsed.data.id, parsed.data.ref);
    return new NextResponse(null, { status: 204 });
  })(req);
}

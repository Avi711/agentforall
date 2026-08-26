import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { getIntegrationsService } from "@/lib/integrations";
import { ConnectParamsSchema } from "@/lib/integrations/schemas";

export const dynamic = "force-dynamic";

// `ref` is the app slug here; the segment shares its name with the sibling DELETE route.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; ref: string }> }) {
  const parsed = ConnectParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    const link = await getIntegrationsService().connect(userId, parsed.data.id, parsed.data.ref);
    return NextResponse.json(link, { status: 201 });
  })(req);
}

import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { getIntegrationsService } from "@/lib/integrations";
import { CatalogSearchSchema } from "@/lib/integrations/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = CatalogSearchSchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return errorJson("invalid_query", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    const data = await getIntegrationsService().search(userId, parsed.data);
    return NextResponse.json({ data });
  })(req);
}

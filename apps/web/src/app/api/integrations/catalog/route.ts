import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { getIntegrationsService } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export const GET = authenticatedHandler({}, async ({ userId }) => {
  const data = await getIntegrationsService().catalog(userId);
  return NextResponse.json({ data });
});

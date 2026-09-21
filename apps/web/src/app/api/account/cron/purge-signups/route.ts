import { NextResponse } from "next/server";
import { errorJson, renderError } from "@/lib/auth/api";
import { isCronRequestAuthorized } from "@/lib/auth/cron";
import { getAuthService } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel Cron: frees emails held by never-confirmed sign-ups, and trims stale rate-limit rows.
export async function GET(req: Request): Promise<Response> {
  if (!isCronRequestAuthorized(req.headers.get("authorization"))) return errorJson("unauthorized", 401);
  try {
    return NextResponse.json(await getAuthService().purgeAbandonedSignUps());
  } catch (err) {
    return renderError(err);
  }
}

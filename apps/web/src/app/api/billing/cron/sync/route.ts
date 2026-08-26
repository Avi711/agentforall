import { NextResponse } from "next/server";
import { errorJson, renderError } from "@/lib/auth/api";
import { isCronRequestAuthorized } from "@/lib/auth/cron";
import { getBillingService } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: re-attributes spend and re-caps every bot with a credit history (expiries need no webhook).
export async function GET(req: Request): Promise<Response> {
  if (!isCronRequestAuthorized(req.headers.get("authorization"))) return errorJson("unauthorized", 401);
  try {
    return NextResponse.json(await getBillingService().syncAllCredits());
  } catch (err) {
    return renderError(err);
  }
}

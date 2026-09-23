import { NextResponse } from "next/server";
import { adminHandler } from "@/lib/auth/admin";
import { errorJson } from "@/lib/auth/api";
import { adminService } from "@/lib/admin/service";
import { GrantCreditsBodySchema } from "@/lib/admin/schemas";

export const POST = adminHandler({ bodySchema: GrantCreditsBodySchema }, async ({ userId, body }) => {
  const credits = await adminService.grantCredits(body.userId, body.credits, body.ref, userId);
  return credits ? NextResponse.json(credits) : errorJson("not_found", 404);
});

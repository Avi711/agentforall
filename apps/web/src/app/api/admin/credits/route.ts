import { NextResponse } from "next/server";
import { adminHandler } from "@/lib/auth/admin";
import { adminService } from "@/lib/admin/service";
import { GrantCreditsBodySchema } from "@/lib/admin/schemas";

export const POST = adminHandler({ bodySchema: GrantCreditsBodySchema }, async ({ userId, body }) =>
  NextResponse.json(await adminService.grantCredits(body.userId, body.credits, body.ref, userId)),
);

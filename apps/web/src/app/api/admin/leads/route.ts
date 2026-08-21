import { NextResponse } from "next/server";
import { adminHandler } from "@/lib/auth/admin";
import { leadService } from "@/lib/leads/service";
import { AdminLeadIdSchema } from "@/lib/leads/schemas";

export const GET = adminHandler({}, async () => {
  const leads = await leadService.list();
  return NextResponse.json({ leads, count: leads.length });
});

export const DELETE = adminHandler(
  { bodySchema: AdminLeadIdSchema },
  async ({ body }) => {
    await leadService.remove(body.id);
    return NextResponse.json({ success: true });
  },
);

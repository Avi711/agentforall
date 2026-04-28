import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth/admin";
import { leadService } from "@/lib/leads/service";
import { AdminLeadIdSchema } from "@/lib/leads/schemas";

export async function GET(request: NextRequest) {
  if (!verifyAdminAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allLeads = await leadService.list();
    return NextResponse.json({ leads: allLeads, count: allLeads.length });
  } catch (err) {
    console.error("[admin/leads] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!verifyAdminAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AdminLeadIdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid lead ID" }, { status: 400 });
  }

  try {
    await leadService.remove(parsed.data.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[admin/leads] delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete lead" },
      { status: 500 },
    );
  }
}

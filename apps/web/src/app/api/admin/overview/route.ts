import { NextResponse } from "next/server";
import { adminHandler } from "@/lib/auth/admin";
import { adminService } from "@/lib/admin/service";

export const GET = adminHandler({}, async () =>
  NextResponse.json(await adminService.overview()),
);

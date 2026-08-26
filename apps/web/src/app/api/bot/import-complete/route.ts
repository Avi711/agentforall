import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BackupRestoreBodySchema } from "@/lib/bots/schemas";
import { toBillingUser } from "@/lib/billing/user";

export const maxDuration = 120;

export const POST = authenticatedHandler(
  { bodySchema: BackupRestoreBodySchema, requireEntitlement: true },
  async ({ user, body }) => {
    const bot = await botService.restoreBackupUpload(toBillingUser(user), body.restoreToken);
    return NextResponse.json({ bot }, { status: 201 });
  },
);

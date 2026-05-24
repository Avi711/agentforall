import { NextResponse } from "next/server";
import { authenticatedHandler } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BackupRestoreBodySchema } from "@/lib/bots/schemas";

export const maxDuration = 120;

export const POST = authenticatedHandler(
  { bodySchema: BackupRestoreBodySchema },
  async ({ userId, body }) => {
    const bot = await botService.restoreBackupUpload(userId, body.restoreToken);
    return NextResponse.json({ bot }, { status: 201 });
  },
);

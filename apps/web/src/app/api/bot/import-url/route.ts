import { authenticatedHandler } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BackupUploadSessionBodySchema } from "@/lib/bots/schemas";

export const POST = authenticatedHandler(
  { bodySchema: BackupUploadSessionBodySchema, requireEntitlement: true },
  async ({ userId, body }) => {
    const session = await botService.createBackupUploadSession(
      userId,
      body,
    );
    return Response.json(session);
  },
);

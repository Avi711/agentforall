import { z } from "zod";
import { BOT_CHANNELS, WHATSAPP_DM_ACCESS } from "../orchestrator/types";

export const BotIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const CreateBotBodySchema = z.object({
  displayName: z.string().min(1, "bot name is required").max(60),
  // The orchestrator needs one channel at creation; an unlinked telegram channel is inert.
  channel: z.enum(BOT_CHANNELS).default("telegram"),
}).strict();

export const BackupUploadSessionBodySchema = z.object({
  displayName: z.string().min(1, "bot name is required").max(60),
  contentLength: z.number().int().positive().max(512 * 1024 * 1024),
  contentType: z.string().min(1).max(128).optional(),
});

export const BackupRestoreBodySchema = z.object({
  restoreToken: z.string().min(1),
});

export const PhoneBodySchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(
      /^\+?[1-9]\d{9,14}$/,
      "phone must be E.164 (country code + number, 10-15 digits)",
    ),
});

export const WhatsappAccessBodySchema = z
  .object({ access: z.enum(WHATSAPP_DM_ACCESS) })
  .strict();

export const OwnerIdentityBodySchema = z
  .object({
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{6,14}$/, "whatsappNumber must be E.164")
      .nullable(),
  })
  .strict();

export type WhatsappAccessBody = z.infer<typeof WhatsappAccessBodySchema>;
export type OwnerIdentityBody = z.infer<typeof OwnerIdentityBodySchema>;
export type CreateBotBody = z.infer<typeof CreateBotBodySchema>;
export type BackupUploadSessionBody = z.infer<typeof BackupUploadSessionBodySchema>;
export type BackupRestoreBody = z.infer<typeof BackupRestoreBodySchema>;
export type PhoneBody = z.infer<typeof PhoneBodySchema>;

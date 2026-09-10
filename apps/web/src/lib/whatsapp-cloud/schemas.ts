import { z } from "zod";

const MetaId = z.string().regex(/^\d{1,64}$/);
const WaId = z.string().regex(/^\d{6,20}$/);

// What the Embedded Signup popup hands the browser (the code dies in 30s), plus the number's PIN when Meta asked for it.
// A number kept in the WhatsApp Business app may come with the account id alone, and never has a PIN.
export const WhatsappCloudConnectBodySchema = z
  .object({
    code: z.string().min(1).max(2048),
    phoneNumberId: MetaId.optional(),
    wabaId: MetaId,
    businessId: MetaId.optional(),
    pin: z.string().regex(/^\d{6}$/).optional(),
    coexistence: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.coexistence === true || (body.phoneNumberId !== undefined && body.businessId !== undefined), {
    message: "phoneNumberId and businessId are required unless the number stays in the WhatsApp Business app",
  })
  .refine((body) => body.coexistence !== true || body.pin === undefined, {
    message: "a number kept in the WhatsApp Business app has no PIN",
  });
export type WhatsappCloudConnectBody = z.infer<typeof WhatsappCloudConnectBodySchema>;

export const WebhookVerifyQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1),
  "hub.challenge": z.string().min(1),
});

// Meta's own message object is kept whole for the plugin; only the routing fields are typed here.
export const InboundMessageSchema = z
  .object({
    id: z.string().min(1).max(255),
    from: WaId,
    timestamp: z.string().regex(/^\d{1,10}$/),
    type: z.string().min(1),
  })
  .passthrough();
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// The owner's own message from the WhatsApp Business app; only who was answered matters here.
export const OwnerEchoSchema = z
  .object({
    id: z.string().min(1).max(255),
    to: WaId,
    timestamp: z.string().regex(/^\d{1,10}$/),
  })
  .passthrough();
export type OwnerEcho = z.infer<typeof OwnerEchoSchema>;

export const AccountUpdateSchema = z
  .object({
    event: z.string(),
    waba_info: z.object({ waba_id: MetaId }).passthrough().optional(),
  })
  .passthrough();

export const ContactSchema = z
  .object({
    wa_id: WaId,
    profile: z.object({ name: z.string().max(255).optional() }).passthrough().optional(),
  })
  .passthrough();

// Only the routing fields are strict; a contact or message Meta shaped unexpectedly is skipped on its own, never the batch.
export const WebhookChangeValueSchema = z
  .object({
    messaging_product: z.literal("whatsapp"),
    metadata: z.object({ phone_number_id: MetaId, display_phone_number: z.string().optional() }).passthrough(),
    contacts: z.array(z.unknown()).optional(),
    messages: z.array(z.unknown()).optional(),
    message_echoes: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const WebhookEnvelopeSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number().optional(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

export const MESSAGES_FIELD = "messages";
export const OWNER_ECHOES_FIELD = "smb_message_echoes";
export const ACCOUNT_UPDATE_FIELD = "account_update";
export const PARTNER_REMOVED_EVENT = "PARTNER_REMOVED";

ALTER TABLE "whatsapp_cloud_numbers" ALTER COLUMN "pin_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_conversations" ADD COLUMN "held_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_conversations" ADD COLUMN "mode_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_numbers" ADD COLUMN "contacts_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_numbers" ADD COLUMN "history_synced_at" timestamp with time zone;
ALTER TABLE "instances" ADD COLUMN "whatsapp_paired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "instances" SET "whatsapp_paired" = ("whatsapp_creds" IS NOT NULL);

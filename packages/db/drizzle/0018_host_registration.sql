ALTER TABLE "hosts" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "last_registered_at" timestamp with time zone;
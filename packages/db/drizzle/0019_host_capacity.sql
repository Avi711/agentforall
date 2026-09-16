ALTER TABLE "hosts" ADD COLUMN "memory_mb" integer;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;
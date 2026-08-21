ALTER TABLE "instances" ADD COLUMN "backup_import_status" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "backup_import_object_name" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "backup_import_content_length" integer;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "backup_import_content_type" varchar(128);

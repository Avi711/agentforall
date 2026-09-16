ALTER TABLE "instances" ADD COLUMN "moved_from_host_id" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "move_object_name" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "moved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "move_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_moved_from_host_id_hosts_id_fk" FOREIGN KEY ("moved_from_host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;
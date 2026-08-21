ALTER TABLE "instances" ADD COLUMN "host_id" text;--> statement-breakpoint
UPDATE "instances" SET "host_id" = 'agent-forall-vm' WHERE "host_id" IS NULL;--> statement-breakpoint
ALTER TABLE "instances" ALTER COLUMN "host_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_instances_host_id" ON "instances" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "idx_instances_host_status" ON "instances" USING btree ("host_id","status");

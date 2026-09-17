CREATE TABLE "instance_settings" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"gateway_token" varchar(256) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_instances_updated_at ON "instances";--> statement-breakpoint
CREATE TRIGGER trg_instances_updated_at
  BEFORE UPDATE ON "instances"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_instance_settings_updated_at
  BEFORE UPDATE ON "instance_settings"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();--> statement-breakpoint
INSERT INTO "instance_settings" ("instance_id", "config", "gateway_token")
  SELECT "id", "config", "gateway_token" FROM "instances";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "config";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "gateway_token";

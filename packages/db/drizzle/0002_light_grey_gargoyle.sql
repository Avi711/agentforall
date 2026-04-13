CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'provisioning' NOT NULL,
	"config" jsonb NOT NULL,
	"container_id" varchar(128),
	"container_name" varchar(128) NOT NULL,
	"gateway_port" integer NOT NULL,
	"gateway_token" varchar(256) NOT NULL,
	"health_failures" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"platform" varchar(20) NOT NULL,
	"interest" text,
	"source" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_instances_gateway_port_active" ON "instances" USING btree ("gateway_port") WHERE "instances"."status" NOT IN ('destroyed', 'error');--> statement-breakpoint
CREATE INDEX "idx_instances_user_id" ON "instances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_instances_status" ON "instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_leads_email" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_leads_created_at" ON "leads" USING btree ("created_at");
CREATE TABLE "integration_sessions" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_session_id" varchar(128) NOT NULL,
	"upstream_mcp_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_sessions" ADD CONSTRAINT "integration_sessions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_integration_sessions_provider_session" ON "integration_sessions" USING btree ("provider","provider_session_id");
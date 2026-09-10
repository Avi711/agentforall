CREATE TABLE "whatsapp_cloud_conversations" (
	"instance_id" uuid NOT NULL,
	"wa_id" varchar(32) NOT NULL,
	"profile_name" varchar(255),
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"mode" varchar(8) DEFAULT 'bot' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_cloud_conversations_instance_id_wa_id_pk" PRIMARY KEY("instance_id","wa_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_cloud_inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wamid" varchar(255) NOT NULL,
	"instance_id" uuid NOT NULL,
	"wa_timestamp" timestamp with time zone NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leased_until" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	CONSTRAINT "whatsapp_cloud_inbox_wamid_unique" UNIQUE("wamid")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_cloud_numbers" (
	"phone_number_id" varchar(64) PRIMARY KEY NOT NULL,
	"instance_id" uuid,
	"waba_id" varchar(64) NOT NULL,
	"pin_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_cloud_numbers_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_cloud_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"wa_id" varchar(32) NOT NULL,
	"wamid" varchar(255),
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_conversations" ADD CONSTRAINT "whatsapp_cloud_conversations_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_inbox" ADD CONSTRAINT "whatsapp_cloud_inbox_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_numbers" ADD CONSTRAINT "whatsapp_cloud_numbers_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_sends" ADD CONSTRAINT "whatsapp_cloud_sends_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_cloud_conversations_updated" ON "whatsapp_cloud_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_cloud_inbox_pending" ON "whatsapp_cloud_inbox" USING btree ("instance_id","wa_timestamp","id") WHERE "whatsapp_cloud_inbox"."acked_at" is null and "whatsapp_cloud_inbox"."dropped_at" is null;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_cloud_inbox_acked" ON "whatsapp_cloud_inbox" USING btree ("acked_at") WHERE "whatsapp_cloud_inbox"."acked_at" is not null;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_cloud_inbox_dropped" ON "whatsapp_cloud_inbox" USING btree ("dropped_at") WHERE "whatsapp_cloud_inbox"."dropped_at" is not null;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_cloud_sends_instance_created" ON "whatsapp_cloud_sends" USING btree ("instance_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_whatsapp_cloud_sends_created" ON "whatsapp_cloud_sends" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "whatsapp_cloud_inbox" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 1000);

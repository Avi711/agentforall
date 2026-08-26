CREATE TABLE "billing_checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"product_code" varchar(32) NOT NULL,
	"credits" integer NOT NULL,
	"amount_agorot" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"provider_checkout_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"credits" integer NOT NULL,
	"used_credits" integer DEFAULT 0 NOT NULL,
	"source_ref" varchar(200) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_credit_usage" (
	"bot_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_spend_usd_cents" integer DEFAULT 0 NOT NULL,
	"consumed_credits" integer DEFAULT 0 NOT NULL,
	"unallocated_credits" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"user_id" text,
	"provider_subscription_id" varchar(128),
	"payload" jsonb NOT NULL,
	"note" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"subscription_id" uuid,
	"provider" varchar(32) NOT NULL,
	"provider_payment_id" varchar(128) NOT NULL,
	"status" varchar(16) NOT NULL,
	"amount_agorot" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"provider" varchar(32) NOT NULL,
	"provider_subscription_id" varchar(128) NOT NULL,
	"provider_customer_id" varchar(128),
	"plan_code" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_trial_claims" (
	"email_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD CONSTRAINT "billing_checkout_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_credit_grants" ADD CONSTRAINT "billing_credit_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_credit_usage" ADD CONSTRAINT "billing_credit_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_trial_claims" ADD CONSTRAINT "billing_trial_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_billing_checkout_sessions_user_created" ON "billing_checkout_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billing_credit_grants_source_ref" ON "billing_credit_grants" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "idx_billing_credit_grants_user_id" ON "billing_credit_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_billing_credit_usage_user_id" ON "billing_credit_usage" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billing_events_provider_event" ON "billing_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_billing_events_subscription" ON "billing_events" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billing_payments_provider_ref" ON "billing_payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "idx_billing_payments_subscription_id" ON "billing_payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_billing_payments_user_id" ON "billing_payments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billing_subscriptions_provider_ref" ON "billing_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_billing_subscriptions_user_id" ON "billing_subscriptions" USING btree ("user_id");
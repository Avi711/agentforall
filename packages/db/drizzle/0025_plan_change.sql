ALTER TABLE "billing_payments" ADD COLUMN "plan_code" varchar(32);--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "scheduled_plan_code" varchar(32);
CREATE TABLE "meta_attribution" (
	"user_id" text PRIMARY KEY NOT NULL,
	"fbp" text,
	"fbc" text,
	"client_ip" text,
	"user_agent" text,
	"country" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_attribution" ADD CONSTRAINT "meta_attribution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "hosts" ("id") SELECT DISTINCT "host_id" FROM "instances";
--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE restrict ON UPDATE no action;
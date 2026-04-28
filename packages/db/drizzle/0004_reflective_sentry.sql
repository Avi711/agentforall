-- Normalize first so case/whitespace dupes surface; unique index then fails loud on real dupes.
UPDATE "leads" SET "email" = LOWER(TRIM("email")) WHERE "email" <> LOWER(TRIM("email"));--> statement-breakpoint
DROP INDEX "idx_leads_email";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_leads_email" ON "leads" USING btree ("email");

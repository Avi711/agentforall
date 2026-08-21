ALTER TABLE "instances" ADD COLUMN "litellm_key_alias" varchar(128);
ALTER TABLE "instances" ADD COLUMN "litellm_key_hash" varchar(128);
ALTER TABLE "instances" ADD COLUMN "litellm_budget_cents" integer;
ALTER TABLE "instances" ADD COLUMN "litellm_budget_duration" varchar(32);
CREATE INDEX "idx_instances_litellm_key_hash" ON "instances" USING btree ("litellm_key_hash");

ALTER TABLE "instances" ADD COLUMN "runtime_kind" varchar(32);
UPDATE "instances" SET "runtime_kind" = 'openclaw' WHERE "runtime_kind" IS NULL;
ALTER TABLE "instances" ALTER COLUMN "runtime_kind" SET DEFAULT 'openclaw';
ALTER TABLE "instances" ALTER COLUMN "runtime_kind" SET NOT NULL;

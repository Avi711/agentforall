CREATE TABLE IF NOT EXISTS "instances" (
  "id"               uuid PRIMARY KEY,
  "user_id"          varchar(255)  NOT NULL,
  "display_name"     varchar(255)  NOT NULL,
  "status"           varchar(32)   NOT NULL DEFAULT 'provisioning',
  "config"           jsonb         NOT NULL,
  "container_id"     varchar(128),
  "container_name"   varchar(128)  NOT NULL,
  "gateway_port"     integer       NOT NULL,
  "gateway_token"    varchar(256)  NOT NULL,
  "health_failures"  integer       NOT NULL DEFAULT 0,
  "error_message"    text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "stopped_at"       timestamp with time zone,
  "destroyed_at"     timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_instances_gateway_port_active"
  ON "instances" ("gateway_port")
  WHERE "status" != 'destroyed';

CREATE INDEX IF NOT EXISTS "idx_instances_user_id"
  ON "instances" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_instances_status"
  ON "instances" ("status");

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_instances_updated_at ON "instances";
CREATE TRIGGER trg_instances_updated_at
  BEFORE UPDATE ON "instances"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

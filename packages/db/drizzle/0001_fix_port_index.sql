DROP INDEX IF EXISTS "idx_instances_gateway_port_active";

CREATE UNIQUE INDEX "idx_instances_gateway_port_active"
  ON "instances" ("gateway_port")
  WHERE "status" NOT IN ('destroyed', 'error');

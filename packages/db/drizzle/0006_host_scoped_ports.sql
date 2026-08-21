DROP INDEX IF EXISTS "idx_instances_gateway_port_active";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_instances_gateway_port_active" ON "instances" USING btree ("host_id","gateway_port") WHERE "instances"."status" NOT IN ('destroyed', 'error');
